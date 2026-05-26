import postgres from 'postgres';
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(process.cwd(), '../../.env.local') });
const sql = postgres(process.env.DATABASE_URL!);
const r = await sql`SELECT COUNT(*)::int AS n FROM bookings WHERE tenant_id = 'ca769cf3-e22e-4148-9fb7-8b9a65c200ef'`;
console.log('Bookings in tenant now:', r[0]!.n);
await sql.end();
