/**
 * Channel-manager → Channex task-id report.
 *
 * Lists the most recent ARI flushes and full-syncs with their Channex
 * task ids — exactly what the PMS certification (Stage 2) asks you to
 * record per test scenario. After triggering a scenario in the UI, wait
 * a few seconds (the ari-flush debounce is 8 s) and run this script to
 * see the resulting task id.
 *
 *   pnpm channex:tasks
 *   pnpm --filter @cm/db channex:tasks
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import postgres from 'postgres';
config({ path: resolve(process.cwd(), '../../.env.local') });

const sql = postgres(process.env.DATABASE_URL!);

const TYPE_LABEL: Record<string, string> = {
  push_availability: 'avail',
  push_rates: 'rates',
  full_sync: 'FULL ',
};

interface SyncRow {
  started_at: Date | null;
  type: string;
  property: string | null;
  payload: { from?: string; to?: string; reason?: string | null; days?: number } | null;
  result: {
    taskIds?: string[];
    availabilityTaskIds?: string[];
    restrictionTaskIds?: string[];
  } | null;
}

function fmtTime(d: Date): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);
}

function extractTaskIds(row: SyncRow): { label: string; id: string }[] {
  const out: { label: string; id: string }[] = [];
  const r = row.result;
  if (!r) return out;
  if (r.availabilityTaskIds) {
    for (const id of r.availabilityTaskIds) out.push({ label: 'avail', id });
  }
  if (r.restrictionTaskIds) {
    for (const id of r.restrictionTaskIds) out.push({ label: 'rates', id });
  }
  if (r.taskIds) {
    for (const id of r.taskIds) {
      out.push({ label: TYPE_LABEL[row.type] ?? row.type, id });
    }
  }
  return out;
}

try {
  const rows = (await sql`
    SELECT s.started_at, s.type, p.name AS property, s.payload, s.result
    FROM sync_jobs s
    LEFT JOIN properties p ON p.id = s.property_id
    WHERE s.type IN ('push_availability','push_rates','full_sync')
    ORDER BY s.started_at DESC NULLS LAST, s.scheduled_at DESC
    LIMIT 30
  `) as unknown as SyncRow[];

  if (rows.length === 0) {
    console.log('Keine ARI- oder Full-Sync-Jobs gefunden.');
    process.exit(0);
  }

  console.log(
    `${'time'.padEnd(20)}  ${'kind'.padEnd(5)}  ${'property'.padEnd(14)}  range / reason`,
  );
  console.log('─'.repeat(96));
  for (const r of rows) {
    const time = r.started_at ? fmtTime(new Date(r.started_at)) : '—'.padEnd(19);
    const kind = TYPE_LABEL[r.type] ?? r.type;
    const property = (r.property ?? '—').padEnd(14).slice(0, 14);
    const range = r.payload?.from && r.payload?.to
      ? `${r.payload.from}…${r.payload.to}${r.payload.days ? ` (${r.payload.days}d)` : ''}`
      : '';
    const reason = r.payload?.reason ? ` · ${r.payload.reason}` : '';
    console.log(`${time}  ${kind}  ${property}  ${range}${reason}`);
    for (const t of extractTaskIds(r)) {
      console.log(`                                          └─ ${t.label}  ${t.id}`);
    }
  }
} finally {
  await sql.end();
}
