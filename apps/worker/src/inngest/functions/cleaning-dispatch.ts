/**
 * Automated cleaning-reminder dispatch.
 *
 * Every 10 minutes (or on the `cleaning/dispatch.now` event):
 *   1. load active cleaning_rules (+ tenant tz / sms sender)
 *   2. for each: resolve apartment allow-list, attached teammates, checklist
 *   3. find candidate bookings, compute the trigger's due time
 *   4. for each due (booking × teammate): atomically claim a
 *      `cleaning_messages` row via ON CONFLICT (rule,booking,teammate)
 *      DO NOTHING
 *   5. render (current booking + next-reservation vars + checklist) and
 *      send the SMS to the teammate's phone
 *   6. walk the row's status lifecycle
 * Also retries rows stuck in `queued` (crash between claim and send).
 *
 * Mirrors messages-dispatch; the recipient is an internal teammate, not the
 * guest, and one rule fans out to N teammates.
 */
import { and, eq, gte, inArray, lt, lte } from 'drizzle-orm';
import {
  bookings,
  createDb,
  cleaningRules,
  cleaningRuleListings,
  cleaningRuleTeammates,
  cleaningMessages,
  properties,
  teammates,
  tenants,
} from '@cm/db';
import {
  findNextReservation,
  computeDueAt,
  sendSms,
  loadAllowedSmsCountries,
  resolveSmsCountry,
} from '@cm/api';
import { env } from '../../env';
import { inngest } from '../client';

/** Don't send a trigger whose due time is older than this (avoid backfill spam). */
const GRACE_MS = 2 * 24 * 60 * 60 * 1000; // 2 days
const ACTIVE_STATUSES = ['confirmed', 'synced', 'pending_sync'] as const;
const MAX_PER_RUN = 200;

export interface CleaningDispatchResult {
  claimed: number;
  sent: number;
  failed: number;
  retried: number;
}

function statusCallbackUrl(): string | undefined {
  if (env.PUBLIC_WEBHOOK_BASE_URL && env.TWILIO_STATUS_SECRET) {
    return `${env.PUBLIC_WEBHOOK_BASE_URL}/api/webhooks/twilio/${env.TWILIO_STATUS_SECRET}`;
  }
  return undefined;
}

async function dispatch(): Promise<CleaningDispatchResult> {
  const db = createDb(env.DATABASE_URL);
  const now = new Date();
  // next-reservation lookup is per (property, checkout) — cache per run.
  const nextCache = new Map<
    string,
    Awaited<ReturnType<typeof findNextReservation>>
  >();

  const rules = await db
    .select({
      id: cleaningRules.id,
      tenantId: cleaningRules.tenantId,
      trigger: cleaningRules.trigger,
      tz: tenants.defaultTimezone,
      smsSenderId: tenants.smsSenderId,
      smsEnabled: tenants.smsEnabled,
    })
    .from(cleaningRules)
    .innerJoin(tenants, eq(tenants.id, cleaningRules.tenantId))
    .where(eq(cleaningRules.active, true));

  let claimed = 0;
  let sent = 0;
  let failed = 0;

  // Bundle: accumulate due cleanings per teammate and send ONE digest SMS each
  // (instead of one SMS per cleaning). teammateId → rows + concise lines.
  const buckets = new Map<
    string,
    { phone: string | null; smsSenderId: string | null; rowIds: string[]; lines: string[] }
  >();

  // Per-tenant SMS country allow-list, loaded once per tenant per run.
  const allowCache = new Map<string, Set<string>>();

  const horizon = new Date(now.getTime() + 60 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const floor = new Date(now.getTime() - 3 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  for (const r of rules) {
    if (claimed >= MAX_PER_RUN) break;
    if (!r.smsEnabled) continue; // SMS add-on not enabled for this tenant
    let allowed = allowCache.get(r.tenantId);
    if (!allowed) {
      allowed = await loadAllowedSmsCountries(db, r.tenantId);
      allowCache.set(r.tenantId, allowed);
    }

    const scoped = new Set(
      (
        await db
          .select({ pid: cleaningRuleListings.propertyId })
          .from(cleaningRuleListings)
          .where(eq(cleaningRuleListings.ruleId, r.id))
      ).map((x) => x.pid),
    );
    if (scoped.size === 0) continue; // reaches no apartment

    const recipients = await db
      .select({
        id: teammates.id,
        phone: teammates.phone,
      })
      .from(cleaningRuleTeammates)
      .innerJoin(teammates, eq(teammates.id, cleaningRuleTeammates.teammateId))
      .where(
        and(
          eq(cleaningRuleTeammates.ruleId, r.id),
          eq(teammates.active, true),
        ),
      );
    if (recipients.length === 0) continue; // nobody to notify

    const candidates = await db
      .select({
        id: bookings.id,
        propertyId: bookings.propertyId,
        guestName: bookings.guestName,
        checkin: bookings.checkin,
        checkout: bookings.checkout,
        checkoutTime: bookings.checkoutTime,
        guestCount: bookings.guestCount,
        createdAt: bookings.createdAt,
        propertyName: properties.name,
      })
      .from(bookings)
      .innerJoin(properties, eq(properties.id, bookings.propertyId))
      .where(
        and(
          eq(bookings.tenantId, r.tenantId),
          inArray(bookings.status, [...ACTIVE_STATUSES]),
          gte(bookings.checkout, floor),
          lte(bookings.checkin, horizon),
        ),
      );

    for (const b of candidates) {
      if (claimed >= MAX_PER_RUN) break;
      if (!scoped.has(b.propertyId)) continue;

      const dueAt = computeDueAt(r.trigger, {
        checkin: b.checkin,
        checkout: b.checkout,
        createdAt: b.createdAt,
        timeZone: r.tz,
      });
      if (!dueAt) continue;
      if (dueAt > now) continue; // not yet
      if (dueAt.getTime() < now.getTime() - GRACE_MS) continue; // too old

      const nkey = `${b.propertyId}|${b.checkout}|${b.id}`;
      let next = nextCache.get(nkey);
      if (next === undefined) {
        next = await findNextReservation(db, b.propertyId, b.checkout, b.id);
        nextCache.set(nkey, next);
      }

      // Concise digest line for this cleaning. Same-day turnover (next arrival
      // on the check-out date) is highlighted — the cleaner's key signal.
      const sameDayArrival =
        next && next.checkin === b.checkout ? (next.checkinTime ?? '15:00') : null;
      const line =
        `• ${b.propertyName} · Check-out ${b.checkoutTime}` +
        (sameDayArrival ? ` · ANREISE ${sameDayArrival}` : '');

      for (const tm of recipients) {
        if (claimed >= MAX_PER_RUN) break;
        const country = resolveSmsCountry(tm.phone);
        if (!country || !allowed.has(country)) continue; // country not enabled

        // Claim one row per (rule,booking,teammate) for dedup; the SMS itself is
        // bundled and sent once per teammate after the loops.
        const inserted = await db
          .insert(cleaningMessages)
          .values({
            tenantId: r.tenantId,
            ruleId: r.id,
            bookingId: b.id,
            teammateId: tm.id,
            body: line,
            toAddress: tm.phone,
            status: 'queued',
            scheduledAt: dueAt,
          })
          .onConflictDoNothing({
            target: [
              cleaningMessages.ruleId,
              cleaningMessages.bookingId,
              cleaningMessages.teammateId,
            ],
          })
          .returning({ id: cleaningMessages.id });
        if (inserted.length === 0) continue; // already handled
        claimed++;

        let bucket = buckets.get(tm.id);
        if (!bucket) {
          bucket = { phone: tm.phone, smsSenderId: r.smsSenderId, rowIds: [], lines: [] };
          buckets.set(tm.id, bucket);
        }
        bucket.rowIds.push(inserted[0]!.id);
        if (!bucket.lines.includes(line)) bucket.lines.push(line);
      }
    }
  }

  // ── Send ONE bundled digest SMS per teammate ─────────────────────────────
  // Cost: 1 SMS per cleaner per run instead of one per cleaning.
  for (const bucket of buckets.values()) {
    if (!bucket.phone) {
      await db
        .update(cleaningMessages)
        .set({ status: 'failed', error: 'no_phone' })
        .where(inArray(cleaningMessages.id, bucket.rowIds));
      failed++;
      continue;
    }
    const body = `Anstehende Reinigungen:\n${bucket.lines.join('\n')}`;
    const from = bucket.smsSenderId || env.TWILIO_FROM;
    const res = await sendSms(
      {
        accountSid: env.TWILIO_ACCOUNT_SID,
        authToken: env.TWILIO_AUTH_TOKEN,
        from,
        statusCallback: statusCallbackUrl(),
      },
      bucket.phone,
      body,
    );
    if (res.ok) {
      sent++;
      await db
        .update(cleaningMessages)
        .set({
          status: 'sent',
          sentAt: new Date(),
          externalId: res.sid,
          fromAddress: from ?? null,
          body,
        })
        .where(inArray(cleaningMessages.id, bucket.rowIds));
    } else {
      failed++;
      await db
        .update(cleaningMessages)
        .set({
          status: 'failed',
          error: res.reason === 'not_configured' ? 'twilio_not_configured' : res.message,
        })
        .where(inArray(cleaningMessages.id, bucket.rowIds));
    }
  }

  // Retry rows stuck in `queued` for > 5 min (claimed but send crashed).
  const stuck = await db
    .select({
      id: cleaningMessages.id,
      body: cleaningMessages.body,
      toAddress: cleaningMessages.toAddress,
      tenantId: cleaningMessages.tenantId,
    })
    .from(cleaningMessages)
    .where(
      and(
        eq(cleaningMessages.status, 'queued'),
        lt(cleaningMessages.createdAt, new Date(now.getTime() - 5 * 60_000)),
      ),
    )
    .limit(50);

  let retried = 0;
  for (const m of stuck) {
    if (!m.toAddress) {
      await db
        .update(cleaningMessages)
        .set({ status: 'failed', error: 'no_phone' })
        .where(eq(cleaningMessages.id, m.id));
      retried++;
      failed++;
      continue;
    }
    const tn = (
      await db
        .select({ smsSenderId: tenants.smsSenderId })
        .from(tenants)
        .where(eq(tenants.id, m.tenantId))
        .limit(1)
    )[0];
    const from = tn?.smsSenderId || env.TWILIO_FROM;
    const res = await sendSms(
      {
        accountSid: env.TWILIO_ACCOUNT_SID,
        authToken: env.TWILIO_AUTH_TOKEN,
        from,
        statusCallback: statusCallbackUrl(),
      },
      m.toAddress,
      m.body,
    );
    retried++;
    await db
      .update(cleaningMessages)
      .set(
        res.ok
          ? { status: 'sent', sentAt: new Date(), externalId: res.sid, fromAddress: from ?? null }
          : {
              status: 'failed',
              error:
                res.reason === 'not_configured'
                  ? 'twilio_not_configured'
                  : res.message,
            },
      )
      .where(eq(cleaningMessages.id, m.id));
    if (res.ok) sent++;
    else failed++;
  }

  return { claimed, sent, failed, retried };
}

export const cleaningDispatch = inngest.createFunction(
  { id: 'cleaning-dispatch', name: 'Dispatch automated cleaning reminders', retries: 2 },
  [{ cron: '*/10 * * * *' }, { event: 'cleaning/dispatch.now' }],
  async ({ step, logger }) => {
    const res = await step.run('dispatch', dispatch);
    if (res.claimed > 0 || res.retried > 0) {
      logger.info(res, 'cleaning dispatch run');
    }
    return res;
  },
);
