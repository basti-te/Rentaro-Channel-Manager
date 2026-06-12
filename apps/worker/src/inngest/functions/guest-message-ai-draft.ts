/**
 * AI guest-reply assistant (Phase 3).
 *
 * On a new inbound guest message (`guest-messages/incoming`), if the tenant has
 * the AI add-on enabled, draft a reply grounded ONLY in the apartment's facts
 * (ai_knowledge + custom vars + booking). The model may call `notify_teammate`
 * to inform a cleaner/handyman in the background when the conversation surfaces
 * an operational task (e.g. missing towels). The guest reply is created as a
 * DRAFT for human approval — unless the tenant turned on Auto-Send.
 *
 * No-op unless ANTHROPIC_API_KEY is set and the tenant opted in. Keys are
 * backend-only. The Claude call is kept model-agnostic (no temperature/effort/
 * thinking params) so ANTHROPIC_MODEL can be opus (default) or haiku for cost.
 */
import Anthropic from '@anthropic-ai/sdk';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  bookings,
  createDb,
  guestMessages,
  properties,
  teammateDispatches,
  teammates,
  tenants,
  type Database,
} from '@cm/db';
import { createChannexClient } from '@cm/channex';
import { resolveCustomVars, sendSms, checkSmsCountry } from '@cm/api';
import { env } from '../../env';
import { inngest } from '../client';

const DEFAULT_MODEL = 'claude-opus-4-8';

export interface AiDraftResult {
  skipped?: string;
  drafted?: boolean;
  autoSent?: boolean;
  dispatches?: number;
}

function statusCallbackUrl(): string | undefined {
  if (env.PUBLIC_WEBHOOK_BASE_URL && env.TWILIO_STATUS_SECRET) {
    return `${env.PUBLIC_WEBHOOK_BASE_URL}/api/webhooks/twilio/${env.TWILIO_STATUS_SECRET}`;
  }
  return undefined;
}

interface Dispatch {
  role: string;
  summary: string;
  urgency?: string;
}
interface ThreadMsg {
  direction: string;
  body: string;
}

/** Build the grounding system prompt from apartment + booking facts. */
function buildSystem(
  propertyName: string,
  guestName: string | null,
  checkin: string,
  checkout: string,
  custom: Record<string, string>,
  knowledge: string | null,
  roles: string[],
): string {
  const facts: string[] = [`Apartment: ${propertyName}`];
  if (guestName) facts.push(`Gast: ${guestName}`);
  facts.push(`Aufenthalt: ${checkin} bis ${checkout}`);
  for (const [k, v] of Object.entries(custom)) if (v) facts.push(`${k}: ${v}`);

  const kb = knowledge?.trim();
  return [
    'Du bist der freundliche Assistent des Gastgebers einer Ferienwohnung und antwortest dem Gast in dessen Sprache.',
    'Beantworte Fragen NUR anhand der unten stehenden Fakten und allgemeiner Höflichkeit. Erfinde nichts — keine Codes, Adressen oder Regeln, die nicht dastehen.',
    'Wenn du etwas nicht sicher weißt, es Sache des Gastgebers ist, oder es eine Beschwerde bzw. heikle Lage ist: sage freundlich, dass du es an den Gastgeber weiterleitest. Rate nicht.',
    roles.length > 0
      ? 'Wenn aus dem Gespräch eine konkrete operative Aufgabe entsteht, die eine Kraft erfordert (z. B. fehlende Handtücher, ein Defekt, Reinigung), nutze das Tool notify_teammate EINMALIG je Kraft, um sie im Hintergrund zu informieren — und bestätige dem Gast knapp, dass du dich darum kümmerst. Nenne dabei KEINE selbst berechneten Daten; verwende nur die Daten aus den FAKTEN. Nutze das Tool nur, wenn wirklich eine Kraft nötig ist, und rufe es nicht mehrfach für dieselbe Sache auf.'
      : '',
    'Halte dich kurz, klar und natürlich.',
    '',
    'FAKTEN ZUM APARTMENT & AUFENTHALT:',
    facts.join('\n'),
    '',
    kb
      ? `HAUSINFO / WISSEN:\n${kb}`
      : 'HAUSINFO / WISSEN: (keine hinterlegt — bei Detailfragen an den Gastgeber verweisen)',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Run the Claude agentic loop: returns the guest reply draft + any dispatches. */
async function draftReply(
  model: string,
  system: string,
  thread: ThreadMsg[],
  roles: string[],
): Promise<{ reply: string | null; dispatches: Dispatch[] }> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const messages: Anthropic.MessageParam[] = thread.map((m) => ({
    role: m.direction === 'inbound' ? 'user' : 'assistant',
    content: m.body,
  }));
  // The Messages API requires the first turn to be `user`.
  while (messages.length > 0 && messages[0]!.role === 'assistant') messages.shift();
  if (messages.length === 0) return { reply: null, dispatches: [] };

  const tools: Anthropic.Tool[] =
    roles.length > 0
      ? [
          {
            name: 'notify_teammate',
            description:
              'Informiere im Hintergrund eine Kraft (z. B. Reinigung oder Hausmeister), wenn aus dem Gespräch eine konkrete Aufgabe entsteht, die diese Kraft erledigen muss. Nur verwenden, wenn wirklich eine Kraft nötig ist.',
            input_schema: {
              type: 'object',
              properties: {
                role: { type: 'string', enum: roles, description: 'Welche Kraft.' },
                summary: { type: 'string', description: 'Kurze Aufgabenbeschreibung für die Kraft.' },
                urgency: { type: 'string', description: 'Optional: Dringlichkeit / Frist.' },
              },
              required: ['role', 'summary'],
            },
          },
        ]
      : [];

  const dispatches: Dispatch[] = [];
  let reply: string | null = null;

  for (let i = 0; i < 4; i++) {
    const res = await client.messages.create({
      model,
      max_tokens: 1024,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      ...(tools.length > 0 ? { tools } : {}),
      messages,
    });

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (text) reply = text;

    const toolUses = res.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );
    if (res.stop_reason !== 'tool_use' || toolUses.length === 0) break;

    messages.push({ role: 'assistant', content: res.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const t of toolUses) {
      if (t.name === 'notify_teammate') {
        const inp = (t.input ?? {}) as { role?: string; summary?: string; urgency?: string };
        if (inp.role && inp.summary) {
          dispatches.push({
            role: String(inp.role),
            summary: String(inp.summary),
            urgency: inp.urgency ? String(inp.urgency) : undefined,
          });
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: t.id,
          content: 'Erledigt — die Kraft wird im Hintergrund informiert.',
        });
      } else {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: t.id,
          content: 'Unbekanntes Tool.',
          is_error: true,
        });
      }
    }
    messages.push({ role: 'user', content: toolResults });
  }

  return { reply, dispatches };
}

async function run(
  db: Database,
  guestMessageId: string,
  bookingId: string,
  tenantId: string,
): Promise<AiDraftResult> {
  const tenant = (
    await db
      .select({
        aiRepliesEnabled: tenants.aiRepliesEnabled,
        aiAutoSend: tenants.aiAutoSend,
        smsEnabled: tenants.smsEnabled,
        smsSenderId: tenants.smsSenderId,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
  )[0];
  if (!tenant?.aiRepliesEnabled) return { skipped: 'disabled' };

  const inbound = (
    await db
      .select({ direction: guestMessages.direction })
      .from(guestMessages)
      .where(eq(guestMessages.id, guestMessageId))
      .limit(1)
  )[0];
  if (!inbound || inbound.direction !== 'inbound') return { skipped: 'not_inbound' };

  const bk = (
    await db
      .select({
        id: bookings.id,
        channexBookingId: bookings.channexBookingId,
        guestName: bookings.guestName,
        checkin: bookings.checkin,
        checkout: bookings.checkout,
        propertyId: bookings.propertyId,
        propertyName: properties.name,
        aiKnowledge: properties.aiKnowledge,
      })
      .from(bookings)
      .innerJoin(properties, eq(properties.id, bookings.propertyId))
      .where(eq(bookings.id, bookingId))
      .limit(1)
  )[0];
  if (!bk) return { skipped: 'no_booking' };

  // Real exchanged thread (drafts/dismissed excluded), chronological.
  const thread = await db
    .select({ direction: guestMessages.direction, body: guestMessages.body })
    .from(guestMessages)
    .where(
      and(
        eq(guestMessages.bookingId, bookingId),
        inArray(guestMessages.status, ['received', 'sent']),
      ),
    )
    .orderBy(asc(sql`coalesce(${guestMessages.otaCreatedAt}, ${guestMessages.createdAt})`));

  const custom = await resolveCustomVars(db, tenantId, bk.propertyId);
  const team = await db
    .select({ id: teammates.id, phone: teammates.phone, role: teammates.role })
    .from(teammates)
    .where(and(eq(teammates.tenantId, tenantId), eq(teammates.active, true)));
  const roles = [...new Set(team.map((t) => t.role))];

  const system = buildSystem(
    bk.propertyName,
    bk.guestName,
    bk.checkin,
    bk.checkout,
    custom,
    bk.aiKnowledge,
    roles,
  );
  const ai = await draftReply(env.ANTHROPIC_MODEL ?? DEFAULT_MODEL, system, thread, roles);

  // ── Execute dispatches (background informing) ───────────────────────────
  // Collapse repeated notify_teammate calls in one run to ONE per role, so a
  // single event can never fan out into a burst of near-identical SMS.
  const seenRoles = new Set<string>();
  const dispatches = ai.dispatches.filter((d) => {
    if (seenRoles.has(d.role)) return false;
    seenRoles.add(d.role);
    return true;
  });
  for (const d of dispatches) {
    const recipients = team.filter((t) => t.role === d.role);
    if (recipients.length === 0) {
      await db.insert(teammateDispatches).values({
        tenantId,
        bookingId,
        role: d.role,
        summary: d.summary,
        urgency: d.urgency ?? null,
        channel: 'none',
        status: 'no_recipient',
      });
      continue;
    }
    for (const r of recipients) {
      let status = 'failed';
      let error: string | null = null;
      const { ok } = await checkSmsCountry(db, tenantId, r.phone);
      if (tenant.smsEnabled && ok) {
        const from = tenant.smsSenderId || env.TWILIO_FROM;
        const text = `Rentaro · ${bk.propertyName}: ${d.summary}${d.urgency ? ` (${d.urgency})` : ''}`;
        const res = await sendSms(
          {
            accountSid: env.TWILIO_ACCOUNT_SID,
            authToken: env.TWILIO_AUTH_TOKEN,
            from,
            statusCallback: statusCallbackUrl(),
          },
          r.phone,
          text,
        );
        status = res.ok ? 'sent' : 'failed';
        error = res.ok
          ? null
          : res.reason === 'not_configured'
            ? 'twilio_not_configured'
            : res.message;
      } else {
        error = tenant.smsEnabled ? 'country_not_allowed' : 'sms_disabled';
      }
      await db.insert(teammateDispatches).values({
        tenantId,
        bookingId,
        teammateId: r.id,
        role: d.role,
        summary: d.summary,
        urgency: d.urgency ?? null,
        channel: 'sms',
        status,
        error,
      });
    }
  }

  if (!ai.reply) return { drafted: false, dispatches: dispatches.length };

  // Replace any prior open draft for this booking with the fresh one.
  await db
    .update(guestMessages)
    .set({ status: 'dismissed', updatedAt: new Date() })
    .where(and(eq(guestMessages.bookingId, bookingId), eq(guestMessages.status, 'draft')));

  if (tenant.aiAutoSend && bk.channexBookingId) {
    const channex = createChannexClient({
      baseUrl: env.CHANNEX_API_URL,
      apiKey: env.CHANNEX_API_KEY,
    });
    try {
      await channex.bookings.sendMessage(bk.channexBookingId, ai.reply);
      await db.insert(guestMessages).values({
        tenantId,
        bookingId,
        direction: 'outbound',
        sender: 'ai',
        body: ai.reply,
        status: 'sent',
        aiGenerated: true,
      });
      return { drafted: true, autoSent: true, dispatches: dispatches.length };
    } catch (e) {
      await db.insert(guestMessages).values({
        tenantId,
        bookingId,
        direction: 'outbound',
        sender: 'ai',
        body: ai.reply,
        status: 'failed',
        aiGenerated: true,
        error: e instanceof Error ? e.message : String(e),
      });
      return { drafted: true, autoSent: false, dispatches: dispatches.length };
    }
  }

  await db.insert(guestMessages).values({
    tenantId,
    bookingId,
    direction: 'outbound',
    sender: 'ai',
    body: ai.reply,
    status: 'draft',
    aiGenerated: true,
  });
  return { drafted: true, autoSent: false, dispatches: dispatches.length };
}

export const guestMessageAiDraft = inngest.createFunction(
  { id: 'guest-message-ai-draft', name: 'Draft an AI reply to a guest message', retries: 1 },
  [{ event: 'guest-messages/incoming' }],
  async ({ event, step, logger }) => {
    if (!env.ANTHROPIC_API_KEY) return { skipped: 'no_api_key' };
    const { guestMessageId, bookingId, tenantId } = event.data;
    const db = createDb(env.DATABASE_URL);
    const res = await step.run('draft', () => run(db, guestMessageId, bookingId, tenantId));
    logger.info(res, 'guest message ai draft');
    return res;
  },
);
