/**
 * Message-template placeholder rendering.
 *
 * Body uses `{{key}}` placeholders. Known keys are substituted; unknown
 * ones are left visible (so typos are obvious in preview/test, not silently
 * blank). Shared by the future scheduler (M3) and the M2 test-send.
 */

/** Supported placeholders, surfaced in the editor as insert hints. */
export const TEMPLATE_VARS: { key: string; label: string }[] = [
  { key: 'guestName', label: 'Gast (Vor- und Nachname)' },
  { key: 'propertyName', label: 'Apartment-Name' },
  { key: 'checkinDate', label: 'Anreisedatum' },
  { key: 'checkoutDate', label: 'Abreisedatum' },
  { key: 'checkinTime', label: 'Check-in-Zeit' },
  { key: 'checkoutTime', label: 'Check-out-Zeit' },
  { key: 'nights', label: 'Anzahl Nächte' },
  { key: 'guestCount', label: 'Anzahl Gäste' },
  { key: 'bookingCode', label: 'Buchungs-/OTA-Code' },
];

export type TemplateVars = Partial<Record<string, string>>;

/** Replace `{{key}}` with vars[key]; unknown keys stay as-is. */
export function renderTemplate(body: string, vars: TemplateVars): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (whole, key: string) => {
    const v = vars[key];
    return v == null || v === '' ? whole : v;
  });
}

/** Realistic placeholder values for editor preview / test-send without a booking. */
export const SAMPLE_VARS: TemplateVars = {
  guestName: 'Max Mustermann',
  propertyName: 'Whg 0',
  checkinDate: '24.07.2026',
  checkoutDate: '27.07.2026',
  checkinTime: '15:00',
  checkoutTime: '11:00',
  nights: '3',
  guestCount: '2',
  bookingCode: 'ABB-12345',
};

/** YYYY-MM-DD → DD.MM.YYYY (German display). */
function deDate(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

function nightsBetween(checkin: string, checkout: string): number {
  const a = new Date(`${checkin.slice(0, 10)}T00:00:00Z`).getTime();
  const b = new Date(`${checkout.slice(0, 10)}T00:00:00Z`).getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

export interface BookingVarSource {
  guestName: string | null;
  checkin: string; // YYYY-MM-DD
  checkout: string; // YYYY-MM-DD
  checkinTime: string | null;
  checkoutTime: string | null;
  guestCount: number | null;
  otaConfirmationCode: string | null;
  propertyName: string;
}

/** Build real placeholder values from a booking row. */
export function buildBookingVars(b: BookingVarSource): TemplateVars {
  return {
    guestName: b.guestName ?? 'Gast',
    propertyName: b.propertyName,
    checkinDate: deDate(b.checkin),
    checkoutDate: deDate(b.checkout),
    checkinTime: b.checkinTime ?? '15:00',
    checkoutTime: b.checkoutTime ?? '11:00',
    nights: String(nightsBetween(b.checkin, b.checkout)),
    guestCount: String(b.guestCount ?? 1),
    bookingCode: b.otaConfirmationCode ?? '',
  };
}
