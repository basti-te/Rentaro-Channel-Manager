/**
 * Seed script — user-aware.
 *
 * Connects the working dataset (3 property groups + 16 apartments) to a
 * specific Supabase Auth user. Idempotent:
 *   - Looks up the user by SEED_USER_EMAIL (env var, defaults to Sebastian).
 *   - Finds the user's tenant via memberships. If the user has no tenant yet,
 *     creates one (mirroring the bootstrap flow).
 *   - Migrates property_groups + properties from any orphan "sebastian-teufel"
 *     tenant (left over from older seed runs) into the user's tenant, then
 *     deletes the orphan tenant.
 *   - Inserts the 3 groups + 16 apartments into the user's tenant if missing.
 *
 * Run with:  pnpm --filter @cm/db seed
 * Or:        SEED_USER_EMAIL=other@x.de pnpm --filter @cm/db seed
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

import {
  tenants,
  propertyGroups,
  properties,
  memberships,
  bookings,
} from '../src/schema';

config({ path: resolve(process.cwd(), '../../.env.local') });

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const TARGET_EMAIL =
  process.env.SEED_USER_EMAIL ?? 'sebastian.teufel.st@gmail.com';

const ORPHAN_SEED_SLUG = 'sebastian-teufel'; // legacy seed tenant

const GROUPS: Array<{ name: string; color: string }> = [
  { name: 'Vorrathstraße',    color: '#B0431C' },
  { name: 'Sybelstraße',      color: '#3D6B4E' },
  { name: 'Manteuffelstraße', color: '#5C5A88' },
];

const APARTMENTS: Array<{ name: string; group: string }> = [
  { name: 'Whg 0',  group: 'Vorrathstraße' },
  { name: 'Whg 1',  group: 'Vorrathstraße' },
  { name: 'Whg 2',  group: 'Vorrathstraße' },
  { name: 'Whg 3',  group: 'Vorrathstraße' },
  { name: 'Whg 4',  group: 'Vorrathstraße' },
  { name: 'Whg 5',  group: 'Vorrathstraße' },
  { name: 'Whg 6',  group: 'Sybelstraße' },
  { name: 'Whg 7',  group: 'Sybelstraße' },
  { name: 'Whg 8',  group: 'Sybelstraße' },
  { name: 'Whg 9',  group: 'Sybelstraße' },
  { name: 'Whg 10', group: 'Manteuffelstraße' },
  { name: 'Whg 11', group: 'Manteuffelstraße' },
  { name: 'Whg 12', group: 'Manteuffelstraße' },
  { name: 'Whg 13', group: 'Manteuffelstraße' },
  { name: 'Whg 17', group: 'Manteuffelstraße' },
  { name: 'Whg 18', group: 'Manteuffelstraße' },
];

const sql = postgres(url, { prepare: false });
const db = drizzle(sql);

try {
  // ── 1. Find the target user in auth.users (raw SQL — Drizzle doesn't know
  //       about the auth schema). The public.users mirror is updated by trigger
  //       but auth.users is the source of truth for logins.
  const authRows = await sql<Array<{ id: string }>>`
    SELECT id FROM auth.users WHERE email = ${TARGET_EMAIL} LIMIT 1
  `;

  if (authRows.length === 0) {
    console.error(
      `! No Supabase Auth user found for ${TARGET_EMAIL}.\n` +
        `  Log in once via the app to create the user, then re-run seed.`,
    );
    process.exit(1);
  }
  const userId = authRows[0]!.id;
  console.log(`✓ User ${TARGET_EMAIL} → ${userId}`);

  // ── 2. Find the user's tenant via memberships. The bootstrap flow creates
  //       this on first login. If somehow missing, create one + ownership.
  let memberRows = await db
    .select({ tenantId: memberships.tenantId, role: memberships.role })
    .from(memberships)
    .where(eq(memberships.userId, userId));

  let userTenantId: string;
  if (memberRows.length === 0) {
    const [t] = await db
      .insert(tenants)
      .values({
        name: TARGET_EMAIL.split('@')[0]!,
        slug: TARGET_EMAIL.split('@')[0]!.replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
        plan: 'free',
        defaultTimezone: 'Europe/Berlin',
        defaultCurrency: 'EUR',
      })
      .returning({ id: tenants.id });
    userTenantId = t!.id;
    await db.insert(memberships).values({
      tenantId: userTenantId,
      userId,
      role: 'owner',
    });
    console.log(`+ Created tenant for user: ${userTenantId}`);
  } else {
    userTenantId = memberRows[0]!.tenantId;
    console.log(`✓ User tenant: ${userTenantId} (role: ${memberRows[0]!.role})`);
  }

  // ── 3. Migrate any orphan "sebastian-teufel" tenant's data into the user's
  //       tenant, then delete the orphan.
  const orphans = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, ORPHAN_SEED_SLUG));

  for (const o of orphans) {
    if (o.id === userTenantId) continue; // user happens to own this slug — skip
    const orphanId = o.id;

    const movedG = await db
      .update(propertyGroups)
      .set({ tenantId: userTenantId })
      .where(eq(propertyGroups.tenantId, orphanId))
      .returning({ id: propertyGroups.id });
    const movedP = await db
      .update(properties)
      .set({ tenantId: userTenantId })
      .where(eq(properties.tenantId, orphanId))
      .returning({ id: properties.id });

    await db.delete(tenants).where(eq(tenants.id, orphanId));
    console.log(
      `→ Migrated orphan tenant ${orphanId}: ${movedG.length} group(s), ${movedP.length} apartment(s); deleted`,
    );
  }

  // ── 4. De-duplicate: if the user's tenant ended up with two groups of the
  //       same name (e.g., migration merged into an existing group), keep the
  //       one with the lowest sort_order and move apartments over.
  const allGroups = await db
    .select()
    .from(propertyGroups)
    .where(eq(propertyGroups.tenantId, userTenantId));
  const groupsByName = new Map<string, typeof allGroups>();
  for (const g of allGroups) {
    if (!groupsByName.has(g.name)) groupsByName.set(g.name, []);
    groupsByName.get(g.name)!.push(g);
  }
  for (const [name, group] of groupsByName) {
    if (group.length <= 1) continue;
    group.sort((a, b) => a.sortOrder - b.sortOrder);
    const keep = group[0]!;
    const dropIds = group.slice(1).map((g) => g.id);
    await db
      .update(properties)
      .set({ groupId: keep.id })
      .where(
        and(
          eq(properties.tenantId, userTenantId),
          inArray(properties.groupId, dropIds),
        ),
      );
    await db.delete(propertyGroups).where(inArray(propertyGroups.id, dropIds));
    console.log(`× Merged ${dropIds.length} duplicate "${name}" group(s)`);
  }

  // ── 5. Seed missing groups
  const existingGroups = await db
    .select()
    .from(propertyGroups)
    .where(eq(propertyGroups.tenantId, userTenantId));
  const groupIds = new Map<string, string>();
  for (const g of existingGroups) groupIds.set(g.name, g.id);

  for (let i = 0; i < GROUPS.length; i++) {
    const g = GROUPS[i]!;
    if (groupIds.has(g.name)) continue;
    const [row] = await db
      .insert(propertyGroups)
      .values({
        tenantId: userTenantId,
        name: g.name,
        color: g.color,
        sortOrder: (i + 1) * 10,
      })
      .returning({ id: propertyGroups.id });
    groupIds.set(g.name, row!.id);
    console.log(`+ Group: ${g.name}`);
  }

  // ── 6. Seed missing apartments
  const existingApts = await db
    .select({ name: properties.name })
    .from(properties)
    .where(eq(properties.tenantId, userTenantId));
  const existingNames = new Set(existingApts.map((a) => a.name));

  let created = 0;
  for (let i = 0; i < APARTMENTS.length; i++) {
    const a = APARTMENTS[i]!;
    if (existingNames.has(a.name)) continue;
    await db.insert(properties).values({
      tenantId: userTenantId,
      groupId: groupIds.get(a.group)!,
      name: a.name,
      sortOrder: (i + 1) * 10,
      defaultRateCents: 8000n, // 80,00 EUR
      defaultMinStay: 2,
    });
    created++;
  }
  console.log(`✓ Apartments: ${created} new, ${existingNames.size} already in place`);

  // Backfill defaults for any apartment whose rate is still null (older seed runs)
  const backfilled = await db
    .update(properties)
    .set({ defaultRateCents: 8000n, defaultMinStay: 2 })
    .where(
      and(eq(properties.tenantId, userTenantId), isNull(properties.defaultRateCents)),
    )
    .returning({ id: properties.id });
  if (backfilled.length > 0) {
    console.log(`↻ Backfilled default rate/min-stay on ${backfilled.length} apartment(s)`);
  }

  // ── 7. Sample bookings — only seed if zero exist yet, otherwise leave the
  //       user's real data alone.
  const existingBookings = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(eq(bookings.tenantId, userTenantId))
    .limit(1);

  if (existingBookings.length === 0) {
    const aptByName = new Map<string, string>();
    const all = await db
      .select({ id: properties.id, name: properties.name })
      .from(properties)
      .where(eq(properties.tenantId, userTenantId));
    for (const a of all) aptByName.set(a.name, a.id);

    /** Days offset from today, formatted as YYYY-MM-DD (UTC-safe). */
    const offset = (d: number) => {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() + d);
      return date.toISOString().slice(0, 10);
    };

    const sample: Array<{
      apt: string;
      checkin: string;
      checkout: string;
      source: 'airbnb' | 'booking_com' | 'internal' | 'block';
      status: 'synced' | 'confirmed' | 'blocked';
      guestName?: string;
      priceCents?: bigint;
    }> = [
      { apt: 'Whg 0', checkin: offset(-2), checkout: offset(3), source: 'airbnb',     status: 'synced',    guestName: 'Lena Hartmann',  priceCents: 36000n },
      { apt: 'Whg 1', checkin: offset(1),  checkout: offset(5), source: 'booking_com',status: 'synced',    guestName: 'Marco Bianchi',  priceCents: 42000n },
      { apt: 'Whg 3', checkin: offset(4),  checkout: offset(11),source: 'airbnb',     status: 'synced',    guestName: 'Sofia Ríos',     priceCents: 78000n },
      { apt: 'Whg 6', checkin: offset(0),  checkout: offset(7), source: 'internal',   status: 'confirmed', guestName: 'Thomas Weber',   priceCents: 52500n },
      { apt: 'Whg 8', checkin: offset(7),  checkout: offset(14),source: 'booking_com',status: 'synced',    guestName: 'Anna Kowalski',  priceCents: 91000n },
      { apt: 'Whg 10',checkin: offset(2),  checkout: offset(6), source: 'block',      status: 'blocked' },
      { apt: 'Whg 12',checkin: offset(10), checkout: offset(13),source: 'airbnb',     status: 'synced',    guestName: 'James O’Connor', priceCents: 33000n },
    ];

    let bk = 0;
    for (const s of sample) {
      const pid = aptByName.get(s.apt);
      if (!pid) continue;
      await db.insert(bookings).values({
        tenantId: userTenantId,
        propertyId: pid,
        source: s.source,
        status: s.status,
        guestName: s.guestName,
        checkin: s.checkin,
        checkout: s.checkout,
        priceCents: s.priceCents,
        currency: 'EUR',
      });
      bk++;
    }
    console.log(`+ Sample bookings: ${bk}`);
  } else {
    console.log(`✓ Bookings already present, sample seeding skipped.`);
  }

  console.log('\nDone.');
} finally {
  await sql.end();
}
