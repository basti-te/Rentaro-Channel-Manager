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
