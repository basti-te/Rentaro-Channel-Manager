/**
 * Cleaning-reminder placeholder rendering + next-reservation lookup.
 *
 * Mirrors services/templates.ts but for the Reinigung module. The recipient
 * is an internal teammate (cleaner), so the variable set is cleaning-centric:
 * the current booking's dates/guest plus the *next* reservation for the same
 * apartment (so the cleaner knows the turnover deadline) and an optional
 * attached checklist rendered into the body via {{checklist}}.
 *
 * Fallback behaviour matches custom-vars: an unknown/empty placeholder is
 * left literal (so missing data is obvious instead of silently blank).
 */
import { and, asc, eq, gte, inArray, ne } from 'drizzle-orm';
import { bookings, type Database } from '@cm/db';
import { renderTemplate, type TemplateVars } from './templates';

/** Booking statuses that count as a real upcoming reservation. */
const ACTIVE_STATUSES = ['confirmed', 'synced', 'pending_sync'] as const;

/** Editor chip catalog (built-in cleaning placeholders). */
export const CLEANING_VARS: { key: string; label: string }[] = [
  { key: 'apartmentName', label: 'Apartment-Name' },
  { key: 'checkinDate', label: 'Anreise (aktuelle Buchung)' },
  { key: 'checkoutDate', label: 'Abreise (aktuelle Buchung)' },
  { key: 'checkoutTime', label: 'Check-out-Zeit' },
  { key: 'guestName', label: 'Gast (aktuelle Buchung)' },
  { key: 'guestCount', label: 'Anzahl Gäste (aktuell)' },
  { key: 'nextCheckinDate', label: 'Nächster Check-in (Datum)' },
  { key: 'nextCheckinTime', label: 'Nächster Check-in (Zeit)' },
  { key: 'nextGuestName', label: 'Nächster Gast (Name)' },
  { key: 'nextGuestCount', label: 'Nächste Buchung: Anzahl Gäste' },
  { key: 'nextNotes', label: 'Nächste Buchung: Notizen' },
  { key: 'checklist', label: 'Checkliste (angehängt)' },
];

/** Realistic values for editor preview / test-send without a booking. */
export const CLEANING_SAMPLE_VARS: TemplateVars = {
  apartmentName: 'Whg 0',
  checkinDate: '21.07.2026',
  checkoutDate: '24.07.2026',
  checkoutTime: '11:00',
  guestName: 'Max Mustermann',
  guestCount: '2',
  nextCheckinDate: '24.07.2026',
  nextCheckinTime: '15:00',
  nextGuestName: 'Erika Beispiel',
  nextGuestCount: '3',
  nextNotes: 'Späte Anreise ~22 Uhr',
  checklist: '• Bad reinigen\n• Bettwäsche wechseln\n• Müll rausbringen',
};

/** YYYY-MM-DD → DD.MM.YYYY (German display). */
function deDate(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

export interface CleaningBookingSource {
  guestName: string | null;
  checkin: string; // YYYY-MM-DD
  checkout: string; // YYYY-MM-DD
  checkoutTime: string | null;
  guestCount: number | null;
  apartmentName: string;
}

export interface NextReservation {
  guestName: string | null;
  checkin: string; // YYYY-MM-DD
  checkinTime: string | null;
  guestCount: number | null;
  notes: string | null;
}

/** Render checklist items as a plain-text bullet list (SMS has no markup). */
export function renderChecklist(items: { label: string }[]): string {
  return items.map((i) => `• ${i.label}`).join('\n');
}

/**
 * The next active reservation for `propertyId` arriving on/after the given
 * checkout date (same-day turnover included), excluding `excludeBookingId`.
 * Returns null when nothing follows.
 */
export async function findNextReservation(
  db: Database,
  propertyId: string,
  afterCheckout: string,
  excludeBookingId: string,
): Promise<NextReservation | null> {
  const row = (
    await db
      .select({
        guestName: bookings.guestName,
        checkin: bookings.checkin,
        checkinTime: bookings.checkinTime,
        guestCount: bookings.guestCount,
        notes: bookings.notes,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.propertyId, propertyId),
          ne(bookings.id, excludeBookingId),
          inArray(bookings.status, [...ACTIVE_STATUSES]),
          gte(bookings.checkin, afterCheckout),
        ),
      )
      .orderBy(asc(bookings.checkin))
      .limit(1)
  )[0];
  return row ?? null;
}

/**
 * Build placeholder values for a cleaning reminder. Keys for which there is
 * no data (e.g. no following reservation) are intentionally omitted so
 * renderTemplate leaves the `{{placeholder}}` literal.
 */
export function buildCleaningVars(
  b: CleaningBookingSource,
  next: NextReservation | null,
  checklistText: string | null,
): TemplateVars {
  const vars: TemplateVars = {
    apartmentName: b.apartmentName,
    checkinDate: deDate(b.checkin),
    checkoutDate: deDate(b.checkout),
    checkoutTime: b.checkoutTime ?? '11:00',
    guestName: b.guestName ?? 'Gast',
    guestCount: String(b.guestCount ?? 1),
  };
  if (next) {
    vars.nextCheckinDate = deDate(next.checkin);
    vars.nextCheckinTime = next.checkinTime ?? '15:00';
    if (next.guestName) vars.nextGuestName = next.guestName;
    if (next.guestCount != null) vars.nextGuestCount = String(next.guestCount);
    if (next.notes) vars.nextNotes = next.notes;
  }
  if (checklistText) vars.checklist = checklistText;
  return vars;
}

export { renderTemplate };
