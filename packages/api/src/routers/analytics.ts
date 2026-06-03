import { z } from 'zod';
import { and, eq, gt, lte, ne, notInArray } from 'drizzle-orm';
import { bookings, properties, tenants, type Database } from '@cm/db';
import { router, tenantProcedure } from '../trpc';

/** 'YYYY-MM-DD' → epoch day number (UTC midnight / 86_400_000). */
function dayNum(s: string): number {
  const [y, m, d] = s.split('-').map(Number);
  return Math.floor(Date.UTC(y!, m! - 1, d!) / 86_400_000);
}
function numToDate(n: number): string {
  const d = new Date(n * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export interface PeriodStats {
  umsatzNetCents: number;
  lodgingCents: number;
  nights: number;
  bookings: number;
  avgStayNights: number;
  avgLeadDays: number;
  occupancyBp: number; // basis points (5000 = 50%)
  adrCents: number;
  revparCents: number;
  daily: { date: string; cents: number }[];
  channels: { key: string; netCents: number; count: number }[];
  topProperties: { propertyId: string; name: string; netCents: number; nights: number }[];
}

/**
 * Per-night revenue recognition over [fromStr, toStr] (inclusive days), net of
 * city tax. Each booking's net (lodging + cleaning) is spread evenly across its
 * nights; only nights falling inside the range are counted. Blocks, drafts,
 * cancellations and pure availability-blocks are excluded.
 */
async function aggregate(
  db: Database,
  tenantId: string,
  propertyId: string | null,
  fromStr: string,
  toStr: string,
  activeApts: number,
): Promise<PeriodStats> {
  const f = dayNum(fromStr);
  const t = dayNum(toStr);
  const rangeDays = t - f + 1;

  const rows = await db
    .select({
      propertyId: bookings.propertyId,
      propertyName: properties.name,
      source: bookings.source,
      checkin: bookings.checkin,
      checkout: bookings.checkout,
      createdAt: bookings.createdAt,
      nightlyRateCents: bookings.nightlyRateCents,
      cleaningFeeCents: bookings.cleaningFeeCents,
      cityTaxCents: bookings.cityTaxCents,
      priceCents: bookings.priceCents,
    })
    .from(bookings)
    .innerJoin(properties, eq(properties.id, bookings.propertyId))
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        ne(bookings.source, 'block'),
        notInArray(bookings.status, ['draft', 'cancelled', 'blocked']),
        lte(bookings.checkin, toStr),
        gt(bookings.checkout, fromStr),
        propertyId ? eq(bookings.propertyId, propertyId) : undefined,
      ),
    );

  let umsatzNet = 0;
  let lodging = 0;
  let nights = 0;
  let bookingsCount = 0;
  let stayNightsSum = 0;
  let leadSum = 0;
  let leadCount = 0;
  const daily = new Map<number, number>();
  const channels = new Map<string, { net: number; count: number }>();
  const props = new Map<string, { name: string; net: number; nights: number }>();

  for (const b of rows) {
    const ci = dayNum(b.checkin);
    const co = dayNum(b.checkout);
    const totalNights = co - ci;
    if (totalNights <= 0) continue;

    const clean = b.cleaningFeeCents != null ? Number(b.cleaningFeeCents) : 0;
    let lodgingTotal: number;
    if (b.nightlyRateCents != null) {
      lodgingTotal = Number(b.nightlyRateCents) * totalNights;
    } else if (b.priceCents != null) {
      lodgingTotal = Number(b.priceCents) - Number(b.cityTaxCents ?? 0n) - clean;
    } else {
      lodgingTotal = 0;
    }
    if (lodgingTotal < 0) lodgingTotal = 0;
    const netTotal = lodgingTotal + clean;
    const perNet = netTotal / totalNights;
    const perLodge = lodgingTotal / totalNights;

    const lo = Math.max(ci, f);
    const hi = Math.min(co - 1, t); // last night = checkout - 1
    const overlap = hi >= lo ? hi - lo + 1 : 0;
    if (overlap <= 0) continue;

    umsatzNet += perNet * overlap;
    lodging += perLodge * overlap;
    nights += overlap;
    bookingsCount++;
    stayNightsSum += totalNights;
    for (let d = lo; d <= hi; d++) daily.set(d, (daily.get(d) ?? 0) + perNet);

    const ch = channels.get(b.source) ?? { net: 0, count: 0 };
    ch.net += perNet * overlap;
    ch.count++;
    channels.set(b.source, ch);

    const pr = props.get(b.propertyId) ?? { name: b.propertyName, net: 0, nights: 0 };
    pr.net += perNet * overlap;
    pr.nights += overlap;
    props.set(b.propertyId, pr);

    if (ci >= f && ci <= t) {
      const created = Math.floor(b.createdAt.getTime() / 86_400_000);
      leadSum += Math.max(0, ci - created);
      leadCount++;
    }
  }

  const availableNights = activeApts * rangeDays;
  const r = Math.round;
  return {
    umsatzNetCents: r(umsatzNet),
    lodgingCents: r(lodging),
    nights,
    bookings: bookingsCount,
    avgStayNights: bookingsCount ? stayNightsSum / bookingsCount : 0,
    avgLeadDays: leadCount ? leadSum / leadCount : 0,
    occupancyBp: availableNights > 0 ? r((nights / availableNights) * 10_000) : 0,
    adrCents: nights > 0 ? r(lodging / nights) : 0,
    revparCents: availableNights > 0 ? r(umsatzNet / availableNights) : 0,
    daily: [...daily.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([d, c]) => ({ date: numToDate(d), cents: r(c) })),
    channels: [...channels.entries()]
      .map(([key, v]) => ({ key, netCents: r(v.net), count: v.count }))
      .sort((a, b) => b.netCents - a.netCents),
    topProperties: [...props.entries()]
      .map(([id, v]) => ({ propertyId: id, name: v.name, netCents: r(v.net), nights: v.nights }))
      .sort((a, b) => b.netCents - a.netCents),
  };
}

export const analyticsRouter = router({
  /** KPIs + daily series + breakdowns for a date range, with prev-period compare. */
  summary: tenantProcedure
    .input(
      z.object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        propertyId: z.string().uuid().nullable().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const pid = input.propertyId ?? null;

      const apts = await ctx.db
        .select({ id: properties.id })
        .from(properties)
        .where(
          and(
            eq(properties.tenantId, ctx.tenantId!),
            eq(properties.active, true),
            pid ? eq(properties.id, pid) : undefined,
          ),
        );
      const activeApts = apts.length;

      const tRow = (
        await ctx.db
          .select({ currency: tenants.defaultCurrency })
          .from(tenants)
          .where(eq(tenants.id, ctx.tenantId!))
          .limit(1)
      )[0];

      const f = dayNum(input.from);
      const t = dayNum(input.to);
      const rangeDays = t - f + 1;
      const prevTo = numToDate(f - 1);
      const prevFrom = numToDate(f - rangeDays);

      const [current, previous] = await Promise.all([
        aggregate(ctx.db, ctx.tenantId!, pid, input.from, input.to, activeApts),
        aggregate(ctx.db, ctx.tenantId!, pid, prevFrom, prevTo, activeApts),
      ]);

      return {
        currency: tRow?.currency ?? 'EUR',
        rangeDays,
        activeApartments: activeApts,
        current,
        previous,
      };
    }),
});
