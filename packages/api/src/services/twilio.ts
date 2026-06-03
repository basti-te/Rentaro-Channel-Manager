/**
 * Minimal Twilio SMS sender — REST API via fetch, no SDK dependency.
 *
 * POST https://api.twilio.com/2010-04-01/Accounts/{Sid}/Messages.json
 * Basic auth: base64(AccountSid:AuthToken). Form-encoded To/From/Body.
 *
 * Credentials are optional in the environment; callers must handle the
 * `not_configured` outcome and surface it to the user instead of crashing.
 */
export interface TwilioConfig {
  accountSid?: string;
  authToken?: string;
  from?: string;
  /** Public URL Twilio POSTs delivery status to. Omitted in local dev
   *  (Twilio can't reach localhost) → status stays "sent", never "delivered". */
  statusCallback?: string;
}

export type TwilioSendResult =
  | { ok: true; sid: string; status: string }
  | { ok: false; reason: 'not_configured' }
  | { ok: false; reason: 'error'; status?: number; message: string };

export function isTwilioConfigured(c: TwilioConfig): boolean {
  return !!(c.accountSid && c.authToken && c.from);
}

export async function sendSms(
  c: TwilioConfig,
  to: string,
  body: string,
): Promise<TwilioSendResult> {
  if (!isTwilioConfigured(c)) return { ok: false, reason: 'not_configured' };

  const auth = Buffer.from(`${c.accountSid}:${c.authToken}`).toString('base64');
  const form = new URLSearchParams({ To: to, From: c.from!, Body: body });
  if (c.statusCallback) form.set('StatusCallback', c.statusCallback);

  let res: Response;
  try {
    res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
        c.accountSid!,
      )}/Messages.json`,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${auth}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      },
    );
  } catch (err) {
    return {
      ok: false,
      reason: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const json = (await res.json().catch(() => null)) as
    | { sid?: string; status?: string; message?: string; code?: number }
    | null;

  if (!res.ok) {
    return {
      ok: false,
      reason: 'error',
      status: res.status,
      message: json?.message ?? `Twilio HTTP ${res.status}`,
    };
  }
  return { ok: true, sid: json?.sid ?? '', status: json?.status ?? 'queued' };
}

/**
 * Estimate how many SMS segments a body bills as, mirroring Twilio's GSM-7 vs
 * UCS-2 segmentation — the basis for usage-based billing.
 *
 *   GSM-7:  ≤160 chars = 1 segment, else 153/segment (7 header bytes).
 *   UCS-2:  ≤70  chars = 1 segment, else 67/segment  (any non-GSM-7 char).
 * GSM-7 extension chars (^ { } [ ] ~ | \\ €) occupy two 7-bit positions each.
 */
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXT = '^{}\\[~]|€';

export function smsSegments(body: string): number {
  if (!body) return 0;
  const chars = [...body];
  const isGsm7 = chars.every(
    (ch) => GSM7_BASIC.includes(ch) || GSM7_EXT.includes(ch),
  );
  if (isGsm7) {
    const len = chars.reduce((n, ch) => n + (GSM7_EXT.includes(ch) ? 2 : 1), 0);
    return len <= 160 ? 1 : Math.ceil(len / 153);
  }
  // UCS-2: count UTF-16 code units (astral chars / emoji count as 2).
  const units = chars.reduce(
    (n, ch) => n + ((ch.codePointAt(0) ?? 0) > 0xffff ? 2 : 1),
    0,
  );
  return units <= 70 ? 1 : Math.ceil(units / 67);
}
