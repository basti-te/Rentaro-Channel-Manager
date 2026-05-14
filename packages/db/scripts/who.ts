import { config } from 'dotenv';
import { resolve } from 'node:path';
import postgres from 'postgres';

config({ path: resolve(process.cwd(), '../../.env.local') });

const sql = postgres(process.env.DATABASE_URL!);
try {
  const users = await sql`
    SELECT id, email, created_at, last_sign_in_at
    FROM auth.users ORDER BY created_at
  `;
  console.log(`auth.users (${users.length}):`);
  for (const u of users) {
    console.log(`  ${u.id}  ${u.email}  signed_in=${u.last_sign_in_at ?? 'never'}`);
  }

  const memb = await sql`
    SELECT m.user_id, m.role, t.name, t.slug, t.id AS tenant_id
    FROM memberships m
    JOIN tenants t ON m.tenant_id = t.id
    ORDER BY t.created_at
  `;
  console.log(`\nmemberships (${memb.length}):`);
  for (const m of memb) {
    console.log(`  user=${m.user_id} role=${m.role} → tenant=${m.tenant_id} (${m.slug})`);
  }

  const tens = await sql`SELECT id, name, slug FROM tenants ORDER BY created_at`;
  console.log(`\nall tenants (${tens.length}):`);
  for (const t of tens) console.log(`  ${t.id}  ${t.slug}  ${t.name}`);
} finally {
  await sql.end();
}
