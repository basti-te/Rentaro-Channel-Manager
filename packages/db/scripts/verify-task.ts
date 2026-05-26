/**
 * End-to-end verification of a Channex task ID before submitting to a
 * cert reviewer. Checks every layer the task touched:
 *
 *   1. DB:        sync_jobs row exists with status='success' and the task
 *                 id stored in result.taskIds
 *   2. DB:        ari_pending outbox is clean for the same range (no stuck
 *                 entries that would indicate the flush didn't drain)
 *   3. Channex:   GET /tasks/<id> — the reviewer's source-of-truth view.
 *                 If this returns 200 with a non-error status, the
 *                 reviewer will see it in their dashboard.
 *
 * Run:  pnpm channex:verify-task <task_id> [<task_id> ...]
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import postgres from 'postgres';
config({ path: resolve(process.cwd(), '../../.env.local') });

const sql = postgres(process.env.DATABASE_URL!);

const taskIds = process.argv.slice(2);
if (taskIds.length === 0) {
  console.error('Usage: pnpm channex:verify-task <task_id> [<task_id> ...]');
  process.exit(1);
}

const CHANNEX_URL = process.env.CHANNEX_API_URL!;
const CHANNEX_KEY = process.env.CHANNEX_API_KEY!;

async function getChannexTask(taskId: string): Promise<Record<string, unknown> | null> {
  const r = await fetch(`${CHANNEX_URL}/tasks/${taskId}`, {
    headers: { 'user-api-key': CHANNEX_KEY, accept: 'application/json' },
  });
  if (!r.ok) {
    return { __error: `HTTP ${r.status} ${r.statusText}` };
  }
  const json = (await r.json()) as { data?: { attributes?: Record<string, unknown> } };
  return json?.data?.attributes ?? null;
}

try {
  for (const t of taskIds) {
    console.log(`\n═══ task ${t} ═══`);

    // 1. Our DB row
    const rows = await sql`
      SELECT s.type, s.status, s.error, s.scheduled_at, s.started_at, s.finished_at,
             s.payload, s.result, p.name AS property_name, cp.channex_property_id
      FROM sync_jobs s
      LEFT JOIN properties p ON p.id = s.property_id
      LEFT JOIN channex_properties cp ON cp.id = p.channex_property_ref
      WHERE s.result::text LIKE ${'%' + t + '%'}
      LIMIT 1
    `;

    let payloadRange: { from?: string; to?: string; reason?: string } | null = null;
    let propName: string | null = null;
    if (rows.length === 0) {
      console.log('  ❌ DB:         no sync_jobs row contains this task id');
    } else {
      const r = rows[0]!;
      const ok = r.status === 'success';
      payloadRange = r.payload as { from?: string; to?: string; reason?: string } | null;
      propName = r.property_name ?? null;
      console.log(`  ${ok ? '✓' : '❌'} DB:         sync_jobs ${r.status}  (${r.type})`);
      console.log(`     finished:   ${r.finished_at?.toISOString() ?? '—'}`);
      console.log(`     property:   ${r.property_name ?? '—'}  (channex=${r.channex_property_id ?? '—'})`);
      if (payloadRange?.from && payloadRange?.to) {
        console.log(`     range:      ${payloadRange.from} → ${payloadRange.to}  reason=${payloadRange.reason ?? '—'}`);
      }
      if (r.error) console.log(`     error:      ${r.error}`);
    }

    // 2. ARI outbox — anything still pending for this task's range?
    if (propName && payloadRange?.from && payloadRange?.to) {
      const pending = await sql`
        SELECT id, kind, date_from, date_to
        FROM ari_pending
        WHERE property_id = (
          SELECT id FROM properties WHERE name = ${propName} LIMIT 1
        )
        AND flushed_at IS NULL
        AND date_from <= ${payloadRange.to}::date
        AND date_to >= ${payloadRange.from}::date
      `;
      if (pending.length === 0) {
        console.log(`  ✓ ARI:        outbox clean for this range`);
      } else {
        console.log(`  ⚠ ARI:        ${pending.length} pending entries overlap this range:`);
        for (const p of pending) {
          console.log(`     - ${p.kind}  ${p.date_from}…${p.date_to}`);
        }
      }
    }

    // 3. Channex's own view
    const attr = await getChannexTask(t);
    if (!attr) {
      console.log(`  ❌ Channex:    task not found in their API`);
      continue;
    }
    if (attr.__error) {
      console.log(`  ❌ Channex:    ${attr.__error}`);
      continue;
    }
    const status = String(attr.status ?? '—');
    const success = status === 'processed' || status === 'success' || status === 'finished';
    const failed = String(status).toLowerCase().includes('error') || String(status).toLowerCase().includes('fail');
    const icon = success ? '✓' : failed ? '❌' : '⚠';
    console.log(`  ${icon} Channex:    /tasks  status=${status}`);
    const interesting = [
      'type', 'kind', 'channel_id', 'channel', 'message',
      'inserted_at', 'completed_at', 'finished_at', 'started_at',
      'errors_count', 'error', 'attempts',
    ] as const;
    for (const k of interesting) {
      if (attr[k] !== undefined && attr[k] !== null && attr[k] !== '') {
        const v = typeof attr[k] === 'object' ? JSON.stringify(attr[k]) : String(attr[k]);
        console.log(`     ${k.padEnd(13)} ${v}`);
      }
    }
  }
} finally {
  await sql.end();
}
