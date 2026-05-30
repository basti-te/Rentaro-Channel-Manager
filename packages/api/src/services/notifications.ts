/**
 * Operator e-mail notifications — the bridge between "something happened in a
 * worker job" and "send the tenant's configured address a heads-up mail".
 *
 * Design (operator decisions 2026-05-30):
 *   - One configurable recipient per tenant (`tenants.notify_email`). Empty =
 *     notifications off entirely (nothing to send to).
 *   - Four independently switchable event classes: new booking, cancellation,
 *     modification, sync/technical error. Each gated by its own boolean column.
 *   - Sent immediately per event (no digest). BEST-EFFORT: every function here
 *     swallows its own errors and returns an outcome — a mail failure must
 *     never break the booking-ingest or ARI-flush job that triggered it.
 *
 * The actual transport is services/email.ts (Resend). This module only decides
 * *whether* to send and *what* to say; the caller passes the EmailConfig built
 * from the worker env so this package stays env-agnostic.
 */
import { eq } from 'drizzle-orm';
import { tenants, type Database } from '@cm/db';
import { sendEmail, type EmailConfig, type EmailSendResult } from './email';

/** The four notifiable event classes. Maps 1:1 to the tenants.notify_* flags. */
export type NotificationKind =
  | 'new_booking'
  | 'cancellation'
  | 'modification'
  | 'sync_error';

export type NotifyOutcome =
  | { sent: true; id: string }
  | { sent: false; reason: 'disabled' | 'no_email' | 'not_configured' | 'error'; message?: string };

/** Booking context for a booking-related notification. All optional-ish so a
 *  sparse Channex payload still produces a useful mail. */
export interface BookingNotificationContext {
  apartmentName: string;
  guestName?: string | null;
  checkin?: string | null; // YYYY-MM-DD
  checkout?: string | null; // YYYY-MM-DD
  otaName?: string | null;
  otaConfirmationCode?: string | null;
}

interface TenantNotifySettings {
  notifyEmail: string | null;
  notifyNewBooking: boolean;
  notifyCancellation: boolean;
  notifyModification: boolean;
  notifySyncError: boolean;
}

const FLAG_BY_KIND: Record<NotificationKind, keyof TenantNotifySettings> = {
  new_booking: 'notifyNewBooking',
  cancellation: 'notifyCancellation',
  modification: 'notifyModification',
  sync_error: 'notifySyncError',
};

async function loadSettings(
  db: Database,
  tenantId: string,
): Promise<TenantNotifySettings | null> {
  const row = (
    await db
      .select({
        notifyEmail: tenants.notifyEmail,
        notifyNewBooking: tenants.notifyNewBooking,
        notifyCancellation: tenants.notifyCancellation,
        notifyModification: tenants.notifyModification,
        notifySyncError: tenants.notifySyncError,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
  )[0];
  return row ?? null;
}

/** Decide whether `kind` should be sent for this tenant, returning the address. */
function resolveRecipient(
  settings: TenantNotifySettings,
  kind: NotificationKind,
): { ok: true; to: string } | { ok: false; reason: 'disabled' | 'no_email' } {
  const email = settings.notifyEmail?.trim();
  if (!email) return { ok: false, reason: 'no_email' };
  if (!settings[FLAG_BY_KIND[kind]]) return { ok: false, reason: 'disabled' };
  return { ok: true, to: email };
}

function toOutcome(send: EmailSendResult): NotifyOutcome {
  if (send.ok) return { sent: true, id: send.id };
  if (send.reason === 'not_configured') return { sent: false, reason: 'not_configured' };
  return { sent: false, reason: 'error', message: send.message };
}

const dash = (v: string | null | undefined) => (v && v.trim() ? v : '—');

/** YYYY-MM-DD → DD.MM.YYYY for display; passthrough if not a date. */
function deDate(v: string | null | undefined): string {
  if (!v) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : v;
}

const KIND_LABEL: Record<Exclude<NotificationKind, 'sync_error'>, string> = {
  new_booking: 'Neue Buchung',
  cancellation: 'Stornierung',
  modification: 'Buchungsänderung',
};

/**
 * Send a booking-related notification (new / cancellation / modification).
 * Best-effort: never throws. Returns why it didn't send so the caller can log.
 */
export async function notifyBookingEvent(
  db: Database,
  email: EmailConfig,
  args: {
    tenantId: string;
    kind: Exclude<NotificationKind, 'sync_error'>;
    booking: BookingNotificationContext;
  },
): Promise<NotifyOutcome> {
  try {
    const settings = await loadSettings(db, args.tenantId);
    if (!settings) return { sent: false, reason: 'no_email' };

    const recipient = resolveRecipient(settings, args.kind);
    if (!recipient.ok) return { sent: false, reason: recipient.reason };

    const { booking } = args;
    const label = KIND_LABEL[args.kind];
    const subject = `${label}: ${dash(booking.apartmentName)} — ${dash(booking.guestName)}`;

    const lines = [
      label,
      '',
      `Apartment:    ${dash(booking.apartmentName)}`,
      `Gast:         ${dash(booking.guestName)}`,
      `Check-in:     ${deDate(booking.checkin)}`,
      `Check-out:    ${deDate(booking.checkout)}`,
      `Kanal:        ${dash(booking.otaName)}`,
      `Buchungscode: ${dash(booking.otaConfirmationCode)}`,
    ];
    const text = lines.join('\n');

    return toOutcome(await sendEmail(email, { to: recipient.to, subject, text }));
  } catch (err) {
    return {
      sent: false,
      reason: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Send a technical/sync-error notification. Best-effort: never throws.
 * `summary` is the subject tail; `detail` is the body (multi-line ok).
 */
export async function notifySyncError(
  db: Database,
  email: EmailConfig,
  args: { tenantId: string; summary: string; detail?: string },
): Promise<NotifyOutcome> {
  try {
    const settings = await loadSettings(db, args.tenantId);
    if (!settings) return { sent: false, reason: 'no_email' };

    const recipient = resolveRecipient(settings, 'sync_error');
    if (!recipient.ok) return { sent: false, reason: recipient.reason };

    const subject = `Sync-Fehler: ${args.summary}`;
    const text = [
      'Bei der Synchronisierung mit Channex ist ein Fehler aufgetreten.',
      '',
      args.summary,
      ...(args.detail ? ['', args.detail] : []),
      '',
      'Die Synchronisierung wird automatisch erneut versucht. Falls der Fehler',
      'bestehen bleibt, prüfe bitte die Channex-Verbindung.',
    ].join('\n');

    return toOutcome(await sendEmail(email, { to: recipient.to, subject, text }));
  } catch (err) {
    return {
      sent: false,
      reason: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
