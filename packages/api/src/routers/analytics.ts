import { z } from 'zod';
import { and, eq, gt, gte, lte, ne, notInArray } from 'drizzle-orm';
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

export interface SeriesPoint {
  date: string;
  netCents: number;
  lodgingCents: number;
  nights: number;
  arrivals: number;
  cancellations: number;
  staySum: number;
  leadSum: number;
}

export interface PeriodStats {
  umsatzNetCents: number;
  lodgingCents: number;
  nights: number;
  bookings: number; // arrivals (check-ins within the range)
  cancellations: number;
  avgStayNights: number;
  avgLeadDays: number;
  occupancyBp: number; // basis points (5000 = 50%)
  adrCents: number;
  revparCents: number;
  series: SeriesPoint[]; // one entry per day in the range (gaps filled with 0)
  channels: { key: string; netCents: number; count: number }[];
  topProperties: { propertyId: string; name: string; netCents: number; nights: number }[];
}

type DayAcc = {
  net: number;
  lodging: number;
  nights: number;
  arrivals: number;
  staySum: number;
  leadSum: number;
  cancels: number;
};

/**
 * Range analytics over [fromStr, toStr] (inclusive days). Two consistent models:
 *  - Per-night recognition (revenue/nights/occupancy/ADR/RevPAR): each booking's
 *    net (lodging + cleaning, excl. city tax) is spread across its nights; only
 *    nights inside the range count.
 *  - Per-booking by check-in (bookings/avg-stay/lead/cancellations): counted on
 *    the check-in day when it falls inside the range.
 * Blocks, drafts and (for revenue) cancellations are excluded.
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

  const day = new Map<number, DayAcc>();
  const acc = (n: number): DayAcc => {
    let a = day.get(n);
    if (!a) {
      a = { net: 0, lodging: 0, nights: 0, arrivals: 0, staySum: 0, leadSum: 0, cancels: 0 };
      day.set(n, a);
    }
    return a;
  };

  let umsatzNet = 0;
  let lodging = 0;
  let nights = 0;
  let arrivals = 0;
  let stayNightsSum = 0;
  let leadSum = 0;
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
    const perNet = (lodgingTotal + clean) / totalNights;
    const perLodge = lodgingTotal / totalNights;

    const lo = Math.max(ci, f);
    const hi = Math.min(co - 1, t);
    const overlap = hi >= lo ? hi - lo + 1 : 0;
    if (overlap > 0) {
      umsatzNet += perNet * overlap;
      lodging += perLodge * overlap;
      nights += overlap;
      for (let d = lo; d <= hi; d++) {
        const a = acc(d);
        a.net += perNet;
        a.lodging += perLodge;
        a.nights += 1;
      }
      const ch = channels.get(b.source) ?? { net: 0, count: 0 };
      ch.net += perNet * overlap;
      ch.count++;
      channels.set(b.source, ch);

      const pr = props.get(b.propertyId) ?? { name: b.propertyName, net: 0, nights: 0 };
      pr.net += perNet * overlap;
      pr.nights += overlap;
      props.set(b.propertyId, pr);
    }

    // Booking-level metrics: count on the check-in day if it's in range.
    if (ci >= f && ci <= t) {
      const created = Math.floor(b.createdAt.getTime() / 86_400_000);
      const lead = Math.max(0, ci - created);
      arrivals++;
      stayNightsSum += totalNights;
      leadSum += lead;
      const a = acc(ci);
      a.arrivals += 1;
      a.staySum += totalNights;
      a.leadSum += lead;
    }
  }

  // Cancellations: cancelled bookings whose check-in falls in the range.
  const cancelled = await db
    .select({ checkin: bookings.checkin })
    .from(bookings)
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        ne(bookings.source, 'block'),
        eq(bookings.status, 'cancelled'),
        gte(bookings.checkin, fromStr),
        lte(bookings.checkin, toStr),
        propertyId ? eq(bookings.propertyId, propertyId) : undefined,
      ),
    );
  let cancellations = 0;
  for (const c of cancelled) {
    cancellations++;
    acc(dayNum(c.checkin)).cancels += 1;
  }

  // Continuous per-day series (fill gaps with zeros) for line charts / sparklines.
  const series: SeriesPoint[] = [];
  for (let d = f; d <= t; d++) {
    const a = day.get(d);
    series.push({
      date: numToDate(d),
      netCents: a ? Math.round(a.net) : 0,
      lodgingCents: a ? Math.round(a.lodging) : 0,
      nights: a?.nights ?? 0,
      arrivals: a?.arrivals ?? 0,
      cancellations: a?.cancels ?? 0,
      staySum: a?.staySum ?? 0,
      leadSum: a?.leadSum ?? 0,
    });
  }

  const availableNights = activeApts * rangeDays;
  const r = Math.round;
  return {
    umsatzNetCents: r(umsatzNet),
    lodgingCents: r(lodging),
    nights,
    bookings: arrivals,
    cancellations,
    avgStayNights: arrivals ? stayNightsSum / arrivals : 0,
    avgLeadDays: arrivals ? leadSum / arrivals : 0,
    occupancyBp: availableNights > 0 ? r((nights / availableNights) * 10_000) : 0,
    adrCents: nights > 0 ? r(lodging / nights) : 0,
    revparCents: availableNights > 0 ? r(umsatzNet / availableNights) : 0,
    series,
    channels: [...channels.entries()]
      .map(([key, v]) => ({ key, netCents: r(v.net), count: v.count }))
      .sort((a, b) => b.netCents - a.netCents),
    topProperties: [...props.entries()]
      .map(([id, v]) => ({ propertyId: id, name: v.name, netCents: r(v.net), nights: v.nights }))
      .sort((a, b) => b.netCents - a.netCents),
  };
}

export const analyticsRouter = router({
  /** KPIs + per-day series + breakdowns for a date range, with prev-period compare. */
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
