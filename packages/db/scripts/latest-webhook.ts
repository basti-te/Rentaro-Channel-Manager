import { config } from 'dotenv';
import { resolve } from 'node:path';
import { desc } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { webhookDeliveries } from '../src/schema';

config({ path: resolve(process.cwd(), '../../.env.local') });

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
const db = drizzle(sql);

try {
  const rows = await db
    .select()
    .from(webhookDeliveries)
    .orderBy(desc(webhookDeliveries.receivedAt))
    .limit(3);

  console.log(`${rows.length} most recent webhook_deliveries:`);
  for (const r of rows) {
    console.log('─'.repeat(60));
    console.log(`source:     ${r.source}`);
    console.log(`event:      ${r.event}`);
    console.log(`tenantId:   ${r.tenantId ?? '(unmapped)'}`);
    console.log(`received:   ${r.receivedAt?.toISOString()}`);
    console.log(`payload:    ${JSON.stringify(r.payload).slice(0, 160)}`);
  }
} finally {
  await sql.end();
}
