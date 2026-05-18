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
