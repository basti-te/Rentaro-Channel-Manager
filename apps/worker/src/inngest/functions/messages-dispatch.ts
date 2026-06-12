/**
 * Automated message dispatch (M3).
 *
 * Every 10 minutes:
 *   1. load active templates (+ tenant tz / sms sender)
 *   2. for each, find candidate bookings and compute the trigger's due time
 *   3. for each due (booking, template): atomically claim a `messages` row
 *      via ON CONFLICT (booking_id, template_id) DO NOTHING
 *   4. render + send via the template's channel (SMS→Twilio, OTA→Channex)
 *   5. update the row's status lifecycle
 * Also retries rows stuck in `queued` (a crash between claim and send).
 *
 * Dedupe is the unique index messages_booking_template_uq — each template
 * fires at most once per booking, regardless of cron overlap or retries.
 */
import { and, eq, gte, inArray, lt, lte } from 'drizzle-orm';
import {
  bookings,
  createDb,
  messages,
  messageBookingOverrides,
  messageTemplateListings,
  messageTemplates,
  properties,
  tenants,
} from '@cm/db';
import { createChannexClient, ChannexError } from '@cm/channex';
import {
  buildBookingVars,
  renderTemplate,
  dispatchDisposition,
  sendSms,
  isTemplateEnabledForBooking,
  isChannelApplicableToSource,
  resolveCustomVars,
  loadAllowedSmsCountries,
  resolveSmsCountry,
} from '@cm/api';
import { env } from '../../env';
import { inngest } from '../client';

const ACTIVE_STATUSES = ['confirmed', 'synced', 'pending_sync'] as const;
const MAX_PER_RUN = 200;

export interface DispatchResult {
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

type SendOutcome =
  | { ok: true; externalId: string | null }
  | { ok: false; error: string };

async function dispatch(): Promise<DispatchResult> {
  const db = createDb(env.DATABASE_URL);
  const now = new Date();
  // Custom variable values are per-apartment — cache per property per run.
  const customVarCache = new Map<string, Record<string, string>>();

  const channex = createChannexClient({
    baseUrl: env.CHANNEX_API_URL,
    apiKey: env.CHANNEX_API_KEY,
  });

  // Active templates + their tenant's tz and SMS sender.
  const tpls = await db
    .select({
      id: messageTemplates.id,
      tenantId: messageTemplates.tenantId,
      channel: messageTemplates.channel,
      trigger: messageTemplates.trigger,
      body: messageTemplates.body,
      tz: tenants.defaultTimezone,
      smsSenderId: tenants.smsSenderId,
      smsEnabled: tenants.smsEnabled,
    })
    .from(messageTemplates)
    .innerJoin(tenants, eq(tenants.id, messageTemplates.tenantId))
    .where(eq(messageTemplates.active, true));

  let claimed = 0;
  let sent = 0;
  let failed = 0;

  // Per-tenant SMS country allow-list, loaded once per tenant per run.
  const allowCache = new Map<string, Set<string>>();

  // Bounded booking window shared across templates of a tenant.
  const horizon = new Date(now.getTime() + 60 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const floor = new Date(now.getTime() - 3 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  for (const t of tpls) {
    if (claimed >= MAX_PER_RUN) break;
    if (t.channel === 'sms' && !t.smsEnabled) continue; // SMS add-on off for tenant
    let allowed: Set<string> | null = null;
    if (t.channel === 'sms') {
      allowed = allowCache.get(t.tenantId) ?? null;
      if (!allowed) {
        allowed = await loadAllowedSmsCountries(db, t.tenantId);
        allowCache.set(t.tenantId, allowed);
      }
    }

    // Apartment scope (explicit allow-list) + per-booking overrides.
    const scoped = new Set(
      (
        await db
          .select({ pid: messageTemplateListings.propertyId })
          .from(messageTemplateListings)
          .where(eq(messageTemplateListings.templateId, t.id))
      ).map((r) => r.pid),
    );
    const ovMap = new Map(
      (
        await db
          .select({
            bookingId: messageBookingOverrides.bookingId,
            enabled: messageBookingOverrides.enabled,
          })
          .from(messageBookingOverrides)
          .where(eq(messageBookingOverrides.templateId, t.id))
      ).map((r) => [r.bookingId, r.enabled]),
    );
    // Nothing to do for this template if it reaches nobody.
    if (scoped.size === 0 && ovMap.size === 0) continue;

    const candidates = await db
      .select({
        id: bookings.id,
        tenantId: bookings.tenantId,
        propertyId: bookings.propertyId,
        source: bookings.source,
        guestName: bookings.guestName,
        guestPhone: bookings.guestPhone,
        checkin: bookings.checkin,
        checkout: bookings.checkout,
        checkinTime: bookings.checkinTime,
        checkoutTime: bookings.checkoutTime,
        guestCount: bookings.guestCount,
        otaConfirmationCode: bookings.otaConfirmationCode,
        channexBookingId: bookings.channexBookingId,
        createdAt: bookings.createdAt,
        propertyName: properties.name,
      })
      .from(bookings)
      .innerJoin(properties, eq(properties.id, bookings.propertyId))
      .where(
        and(
          eq(bookings.tenantId, t.tenantId),
          inArray(bookings.status, [...ACTIVE_STATUSES]),
          gte(bookings.checkout, floor),
          lte(bookings.checkin, horizon),
        ),
      );

    for (const b of candidates) {
      if (claimed >= MAX_PER_RUN) break;
      if (
        !isTemplateEnabledForBooking({
          propertyId: b.propertyId,
          scopedPropertyIds: scoped,
          override: ovMap.get(b.id),
        })
      )
        continue;
      // An OTA template is posted into the booking's one real OTA chat (Channex
      // routes by booking, not by channel). So a booking_com template must only
      // fire for booking_com bookings and an airbnb template only for airbnb —
      // otherwise both land in the same chat and the guest is messaged twice.
      if (!isChannelApplicableToSource(t.channel, b.source)) continue;
      // Same decision (incl. the 2-day grace) the booking-detail timeline shows,
      // so the UI label always matches what actually happens here.
      const { due: dueAt, disposition } = dispatchDisposition(
        t.trigger,
        {
          checkin: b.checkin,
          checkout: b.checkout,
          createdAt: b.createdAt,
          timeZone: t.tz,
        },
        now.getTime(),
      );
      if (!dueAt || disposition !== 'due') continue;
      if (t.channel === 'sms') {
        const country = resolveSmsCountry(b.guestPhone);
        if (!country || !allowed!.has(country)) continue; // country not enabled
      }

      const baseVars = buildBookingVars({
        guestName: b.guestName,
        checkin: b.checkin,
        checkout: b.checkout,
        checkinTime: b.checkinTime,
        checkoutTime: b.checkoutTime,
        guestCount: b.guestCount,
        otaConfirmationCode: b.otaConfirmationCode,
        propertyName: b.propertyName,
      });
      let custom = customVarCache.get(b.propertyId);
      if (!custom) {
        custom = await resolveCustomVars(db, t.tenantId, b.propertyId);
        customVarCache.set(b.propertyId, custom);
      }
      const renderedBody = renderTemplate(t.body, {
        ...baseVars,
        ...custom,
      });

      // Atomic claim — unique (booking_id, template_id) gates duplicates.
      const inserted = await db
        .insert(messages)
        .values({
          tenantId: t.tenantId,
          bookingId: b.id,
          templateId: t.id,
          channel: t.channel,
          direction: 'outbound',
          body: renderedBody,
          status: 'queued',
          scheduledAt: dueAt,
        })
        .onConflictDoNothing({
          target: [messages.bookingId, messages.templateId],
        })
        .returning({ id: messages.id });

      if (inserted.length === 0) continue; // already handled
      claimed++;

      const outcome = await sendOne(
        channex,
        t.channel,
        renderedBody,
        b.guestPhone,
        b.channexBookingId,
        t.smsSenderId || env.TWILIO_FROM,
      );

      if (outcome.ok) {
        sent++;
        await db
          .update(messages)
          .set({
            status: 'sent',
            sentAt: new Date(),
            externalId: outcome.externalId,
            toAddress: t.channel === 'sms' ? b.guestPhone : b.channexBookingId,
            fromAddress: t.channel === 'sms' ? t.smsSenderId || env.TWILIO_FROM : null,
          })
          .where(eq(messages.id, inserted[0]!.id));
      } else {
        failed++;
        await db
          .update(messages)
          .set({ status: 'failed', error: outcome.error })
          .where(eq(messages.id, inserted[0]!.id));
      }
    }
  }

  // Retry rows stuck in `queued` for > 5 min (claimed but send crashed).
  const stuck = await db
    .select({
      id: messages.id,
      channel: messages.channel,
      body: messages.body,
      bookingId: messages.bookingId,
      tenantId: messages.tenantId,
    })
    .from(messages)
    .where(
      and(
        eq(messages.status, 'queued'),
        lt(messages.createdAt, new Date(now.getTime() - 5 * 60_000)),
      ),
    )
    .limit(50);

  let retried = 0;
  for (const m of stuck) {
    const b = (
      await db
        .select({
          guestPhone: bookings.guestPhone,
          channexBookingId: bookings.channexBookingId,
        })
        .from(bookings)
        .where(eq(bookings.id, m.bookingId!))
        .limit(1)
    )[0];
    const tn = (
      await db
        .select({ smsSenderId: tenants.smsSenderId })
        .from(tenants)
        .where(eq(tenants.id, m.tenantId))
        .limit(1)
    )[0];
    const outcome = await sendOne(
      channex,
      m.channel,
      m.body,
      b?.guestPhone ?? null,
      b?.channexBookingId ?? null,
      tn?.smsSenderId || env.TWILIO_FROM,
    );
    retried++;
    await db
      .update(messages)
      .set(
        outcome.ok
          ? { status: 'sent', sentAt: new Date(), externalId: outcome.externalId }
          : { status: 'failed', error: outcome.error },
      )
      .where(eq(messages.id, m.id));
    if (outcome.ok) sent++;
    else failed++;
  }

  return { claimed, sent, failed, retried };
}

async function sendOne(
  channex: ReturnType<typeof createChannexClient>,
  channel: 'sms' | 'airbnb' | 'booking_com' | 'email',
  body: string,
  guestPhone: string | null,
  channexBookingId: string | null,
  smsFrom: string | undefined,
): Promise<SendOutcome> {
  if (channel === 'sms') {
    if (!guestPhone) return { ok: false, error: 'no_phone' };
    const r = await sendSms(
      {
        accountSid: env.TWILIO_ACCOUNT_SID,
        authToken: env.TWILIO_AUTH_TOKEN,
        from: smsFrom,
        statusCallback: statusCallbackUrl(),
      },
      guestPhone,
      body,
    );
    if (r.ok) return { ok: true, externalId: r.sid };
    return {
      ok: false,
      error: r.reason === 'not_configured' ? 'twilio_not_configured' : r.message,
    };
  }
  if (channel === 'airbnb' || channel === 'booking_com') {
    if (!channexBookingId) return { ok: false, error: 'no_channex_booking' };
    try {
      await channex.bookings.sendMessage(channexBookingId, body);
      return { ok: true, externalId: null };
    } catch (err) {
      const msg =
        err instanceof ChannexError
          ? `channex_${err.status ?? '?'}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      return { ok: false, error: msg };
    }
  }
  return { ok: false, error: 'channel_not_supported' };
}

export const messagesDispatch = inngest.createFunction(
  { id: 'messages-dispatch', name: 'Dispatch automated guest messages', retries: 2 },
  [{ cron: '*/10 * * * *' }, { event: 'messages/dispatch.now' }],
  async ({ step, logger }) => {
    const res = await step.run('dispatch', dispatch);
    if (res.claimed > 0 || res.retried > 0) {
      logger.info(res, 'messages dispatch run');
    }
    return res;
  },
);
