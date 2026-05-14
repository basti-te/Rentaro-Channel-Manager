/**
 * One-shot script: connect the FIRST apartment of the user's tenant to a
 * specific Channex sandbox property.
 *
 * Useful for getting Phase 5 end-to-end testing off the ground. After this:
 *   - Whg 0 (or whatever the first sortOrder apartment is) has a
 *     channex_property_ref pointing at a real Channex property+roomType+ratePlan
 *   - Creating a booking on that apartment triggers a real availability push
 *
 * Defaults are hard-coded to the IDs printed by `pnpm channex:smoke`.
 * Override via env: SEED_USER_EMAIL, CHANNEX_TEST_*.
 *
 * Idempotent: re-running upserts the channex_properties row and keeps the
 * apartment link intact.
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';
import { and, asc, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { channexProperties, memberships, properties } from '../src/schema';

config({ path: resolve(process.cwd(), '../../.env.local') });

const TARGET_EMAIL =
  process.env.SEED_USER_EMAIL ?? 'sebastian.teufel.st@gmail.com';

// Defaults from the smoke test against the sandbox
const CHANNEX_PROPERTY_ID =
  process.env.CHANNEX_TEST_PROPERTY_ID ?? 'd7d2200f-5c05-48aa-b2e4-d9dc9c2df930';
const CHANNEX_ROOM_TYPE_ID =
  process.env.CHANNEX_TEST_ROOM_TYPE_ID ?? '7291e15e-7ac7-4517-8d93-a88e5c4933fb';
const CHANNEX_RATE_PLAN_ID =
  process.env.CHANNEX_TEST_RATE_PLAN_ID ?? 'f192e378-77f3-461a-9485-2de8a7dbe003';

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const sql = postgres(url, { prepare: false });
const db = drizzle(sql);

try {
  // 1. Find the user by email (auth.users via raw SQL)
  const users = await sql<Array<{ id: string }>>`
    SELECT id FROM auth.users WHERE email = ${TARGET_EMAIL} LIMIT 1
  `;
  if (users.length === 0) {
    console.error(`! User ${TARGET_EMAIL} not found in auth.users — log in first.`);
    process.exit(1);
  }
  const userId = users[0]!.id;

  // 2. Find their tenant via memberships
  const m = (
    await db
      .select({ tenantId: memberships.tenantId })
      .from(memberships)
      .where(eq(memberships.userId, userId))
      .limit(1)
  )[0];
  if (!m) {
    console.error(`! No tenant for user ${userId}.`);
    process.exit(1);
  }
  const tenantId = m.tenantId;
  console.log(`✓ Tenant: ${tenantId}`);

  // 3. Upsert channex_properties row keyed on channex_property_id
  let channexRowId: string;
  const existing = await db
    .select({ id: channexProperties.id })
    .from(channexProperties)
    .where(eq(channexProperties.channexPropertyId, CHANNEX_PROPERTY_ID))
    .limit(1);
  if (existing.length > 0) {
    channexRowId = existing[0]!.id;
    await db
      .update(channexProperties)
      .set({
        tenantId,
        channexRoomTypeId: CHANNEX_ROOM_TYPE_ID,
        channexRatePlanId: CHANNEX_RATE_PLAN_ID,
        updatedAt: new Date(),
      })
      .where(eq(channexProperties.id, channexRowId));
    console.log(`↻ Updated existing channex_properties row ${channexRowId}`);
  } else {
    const [inserted] = await db
      .insert(channexProperties)
      .values({
        tenantId,
        channexPropertyId: CHANNEX_PROPERTY_ID,
        channexRoomTypeId: CHANNEX_ROOM_TYPE_ID,
        channexRatePlanId: CHANNEX_RATE_PLAN_ID,
        timezone: 'Europe/Berlin',
        currency: 'EUR',
      })
      .returning({ id: channexProperties.id });
    channexRowId = inserted!.id;
    console.log(`+ Created channex_properties row ${channexRowId}`);
  }

  // 4. Link the FIRST sorted apartment (Whg 0) to this Channex property
  const firstApt = (
    await db
      .select({ id: properties.id, name: properties.name })
      .from(properties)
      .where(eq(properties.tenantId, tenantId))
      .orderBy(asc(properties.sortOrder), asc(properties.name))
      .limit(1)
  )[0];

  if (!firstApt) {
    console.error('! No apartments in tenant — run db:seed first.');
    process.exit(1);
  }

  await db
    .update(properties)
    .set({ channexPropertyRef: channexRowId, updatedAt: new Date() })
    .where(and(eq(properties.id, firstApt.id), eq(properties.tenantId, tenantId)));
  console.log(`✓ Linked apartment "${firstApt.name}" (${firstApt.id}) → channex ${channexRowId}`);

  console.log('\nDone. Creating a booking on this apartment will now push availability to Channex.');
} finally {
  await sql.end();
}
