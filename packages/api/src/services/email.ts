/**
 * Minimal Resend transactional-email sender — REST API via fetch, no SDK.
 *
 * POST https://api.resend.com/emails
 * Bearer auth: the Resend API key. JSON body {from,to,subject,html,text}.
 *
 * Credentials are optional in the environment; callers must handle the
 * `not_configured` outcome and surface/log it instead of crashing. This
 * mirrors services/twilio.ts so the whole app degrades gracefully when an
 * integration isn't set up yet.
 *
 * NOTE: This is operator-facing transactional mail (booking/sync alerts),
 * NOT guest mail and NOT the Supabase-Auth magic-link mail (that goes through
 * Supabase's own SMTP). Different channel, different sender.
 */
export interface EmailConfig {
  /** Resend API key (`re_…`). Unset → not configured. */
  apiKey?: string;
  /** Default From, e.g. `Rentaro <alerts@rentaro.cloud>`. Unset → not configured. */
  from?: string;
}

export type EmailSendResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'not_configured' }
  | { ok: false; reason: 'error'; status?: number; message: string };

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain-text body. Always set — some clients prefer it, and it's the fallback. */
  text: string;
  /** Optional HTML body. */
  html?: string;
  /** Optional Reply-To override. */
  replyTo?: string;
}

export function isEmailConfigured(c: EmailConfig): boolean {
  return !!(c.apiKey && c.from);
}

export async function sendEmail(
  c: EmailConfig,
  msg: EmailMessage,
): Promise<EmailSendResult> {
  if (!isEmailConfigured(c)) return { ok: false, reason: 'not_configured' };

  const body: Record<string, unknown> = {
    from: c.from,
    to: [msg.to],
    subject: msg.subject,
    text: msg.text,
  };
  if (msg.html) body.html = msg.html;
  if (msg.replyTo) body.reply_to = msg.replyTo;

  let res: Response;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${c.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      reason: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const json = (await res.json().catch(() => null)) as
    | { id?: string; message?: string; name?: string }
    | null;

  if (!res.ok) {
    return {
      ok: false,
      reason: 'error',
      status: res.status,
      message: json?.message ?? json?.name ?? `Resend HTTP ${res.status}`,
    };
  }
  return { ok: true, id: json?.id ?? '' };
}
