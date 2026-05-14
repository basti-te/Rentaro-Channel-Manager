import { config } from 'dotenv';
import { resolve } from 'node:path';
import { desc } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { syncJobs } from '../src/schema';

config({ path: resolve(process.cwd(), '../../.env.local') });

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
const db = drizzle(sql);

try {
  const rows = await db
    .select()
    .from(syncJobs)
    .orderBy(desc(syncJobs.scheduledAt))
    .limit(3);
  for (const r of rows) {
    console.log('─'.repeat(60));
    console.log(`id:         ${r.id}`);
    console.log(`type:       ${r.type}`);
    console.log(`status:     ${r.status}`);
    console.log(`scheduled:  ${r.scheduledAt?.toISOString()}`);
    console.log(`started:    ${r.startedAt?.toISOString() ?? '-'}`);
    console.log(`finished:   ${r.finishedAt?.toISOString() ?? '-'}`);
    if (r.payload) console.log(`payload:    ${JSON.stringify(r.payload)}`);
    if (r.result) console.log(`result:     ${JSON.stringify(r.result)}`);
    if (r.error) console.log(`error:      ${r.error}`);
  }
} finally {
  await sql.end();
}
