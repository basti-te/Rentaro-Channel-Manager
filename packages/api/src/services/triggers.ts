/**
 * Message-template trigger DSL.
 *
 * Supported forms (stored in message_templates.trigger):
 *   booking_created            → due as soon as the booking exists
 *   checkin:-1d@18:00          → 1 day before check-in, 18:00 property-local
 *   checkin:+0d@10:00          → day of check-in, 10:00 local
 *   checkout:+0d@10:00         → day of check-out, 10:00 local
 *   <checkin|checkout>:<±N>d@<HH:MM>
 *
 * Times are property-local; we resolve them to a real UTC instant using the
 * tenant timezone (DST-correct via Intl, no date lib needed).
 */

export type TriggerAnchor = 'reservation' | 'checkin' | 'checkout';

export interface ParsedTrigger {
  kind: 'booking_created' | 'anchored';
  anchor?: TriggerAnchor;
  dayOffset?: number; // signed, e.g. -1, 0, 2
  hour?: number;
  minute?: number;
}

const ANCHORED_RE =
  /^(reservation|checkin|checkout):([+-]?\d{1,3})d@([01]\d|2[0-3]):([0-5]\d)$/;

export function parseTrigger(raw: string): ParsedTrigger | null {
  const s = raw.trim();
  // Legacy: bare "booking_created" fires at the exact creation instant.
  if (s === 'booking_created') return { kind: 'booking_created' };
  const m = ANCHORED_RE.exec(s);
  if (!m) return null;
  const dayOffset = Number(m[2]);
  if (Math.abs(dayOffset) > 90) return null; // builder caps at 1–90 days
  return {
    kind: 'anchored',
    anchor: m[1] as TriggerAnchor,
    dayOffset,
    hour: Number(m[3]),
    minute: Number(m[4]),
  };
}

/** Offset (minutes) of `timeZone` from UTC at the given UTC instant. */
function tzOffsetMinutes(at: Date, timeZone: string): number {
  // Format the instant in the target tz, read it back as if it were UTC,
  // the delta is the offset. Robust across DST.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const p = Object.fromEntries(
    dtf.formatToParts(at).map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  const asUTC = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    p.hour === '24' ? 0 : Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return Math.round((asUTC - at.getTime()) / 60000);
}

/**
 * Convert a wall-clock time in `timeZone` to a UTC Date.
 * Two-pass to settle DST boundaries.
 */
function zonedWallTimeToUtc(
  year: number,
  month1: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const naiveUtc = Date.UTC(year, month1 - 1, day, hour, minute, 0);
  let guess = new Date(naiveUtc - tzOffsetMinutes(new Date(naiveUtc), timeZone) * 60000);
  // Re-check with the actual offset at the guessed instant.
  const off2 = tzOffsetMinutes(guess, timeZone);
  guess = new Date(naiveUtc - off2 * 60000);
  return guess;
}

/** Add `days` to a YYYY-MM-DD string → {y,m,d}. */
function shiftYmd(ymd: string, days: number) {
  const parts = ymd.slice(0, 10).split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return { year: t.getUTCFullYear(), month1: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** Calendar date (YYYY-MM-DD) of a UTC instant *in* the given timezone. */
function utcToZonedYmd(at: Date, timeZone: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  return `${p.year}-${p.month}-${p.day}`;
}

export interface DueContext {
  /** YYYY-MM-DD */
  checkin: string;
  /** YYYY-MM-DD */
  checkout: string;
  /** When the booking row was created (used for booking_created). */
  createdAt: Date;
  timeZone: string;
}

/**
 * The UTC instant a template becomes due for a booking, or null if the
 * trigger string is invalid.
 */
export function computeDueAt(trigger: string, ctx: DueContext): Date | null {
  const p = parseTrigger(trigger);
  if (!p) return null;
  if (p.kind === 'booking_created') return ctx.createdAt;

  const base =
    p.anchor === 'reservation'
      ? utcToZonedYmd(ctx.createdAt, ctx.timeZone)
      : p.anchor === 'checkout'
        ? ctx.checkout
        : ctx.checkin;
  const { year, month1, day } = shiftYmd(base, p.dayOffset!);
  return zonedWallTimeToUtc(year, month1, day, p.hour!, p.minute!, ctx.timeZone);
}
