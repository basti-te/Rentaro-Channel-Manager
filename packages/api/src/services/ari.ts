/**
 * ARI outbox enqueue helper.
 *
 * Mutations call this instead of pushing to Channex directly. It writes
 * dirty-range rows to `ari_pending` and emits a single `ari/changed` trigger;
 * the worker's global debounced + throttled flusher does the batched push.
 *
 * This is what keeps us inside Channex's 20 ARI/min limit: N mutations →
 * N tiny DB inserts + N cheap events → ONE coalesced flush → ~2 API calls.
 */
import { ariPending, type Database } from '@cm/db';

export type AriKind = 'availability' | 'rates';

interface EnqueueCtx {
  db: Database;
  inngest: { send: (e: { name: 'ari/changed'; data: { reason?: string } }) => Promise<unknown> };
}

export interface AriChange {
  tenantId: string;
  propertyId: string;
  /** Which Channex stream(s) this change affects. */
  kinds: AriKind[];
  /** Inclusive YYYY-MM-DD. */
  from: string;
  /** EXCLUSIVE YYYY-MM-DD. */
  to: string;
  reason?: string;
}

/**
 * Enqueue one or more ARI changes and nudge the flusher. Safe to call with
 * several changes at once (e.g. a booking that moved between properties) —
 * they're inserted in one statement and a single trigger is emitted.
 */
export async function enqueueAri(
  ctx: EnqueueCtx,
  changes: AriChange | AriChange[],
): Promise<void> {
  const list = Array.isArray(changes) ? changes : [changes];
  if (list.length === 0) return;

  const rows = list.flatMap((c) =>
    c.kinds.map((kind) => ({
      tenantId: c.tenantId,
      propertyId: c.propertyId,
      kind,
      dateFrom: c.from,
      dateTo: c.to,
      reason: c.reason ?? null,
    })),
  );
  if (rows.length === 0) return;

  await ctx.db.insert(ariPending).values(rows);
  await ctx.inngest.send({
    name: 'ari/changed',
    data: { reason: list[0]?.reason },
  });
}
