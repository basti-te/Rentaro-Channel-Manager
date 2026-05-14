/**
 * Seed script — adds Sebastian's tenant + 3 groups + 17 apartments.
 *
 * Idempotent: re-running won't duplicate rows (matched by tenant slug + name).
 *
 * Run with:  pnpm --filter @cm/db seed
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';
import { eq, and } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

import { tenants, propertyGroups, properties } from '../src/schema';

config({ path: resolve(process.cwd(), '../../.env.local') });

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const sql = postgres(url, { prepare: false });
const db = drizzle(sql);

const TENANT = {
  name: 'Sebastian Teufel',
  slug: 'sebastian-teufel',
};

const GROUPS: Array<{ name: string; color: string }> = [
  { name: 'Vorrathstraße',    color: '#B0431C' }, // terracotta
  { name: 'Sybelstraße',      color: '#3D6B4E' }, // muted green
  { name: 'Manteuffelstraße', color: '#5C5A88' }, // muted indigo
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

try {
  // 1. Tenant
  let tenantId: string;
  const existingTenant = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, TENANT.slug))
    .limit(1);

  if (existingTenant.length > 0) {
    tenantId = existingTenant[0]!.id;
    console.log(`✓ Tenant "${TENANT.slug}" already exists (${tenantId})`);
  } else {
    const [t] = await db
      .insert(tenants)
      .values({
        name: TENANT.name,
        slug: TENANT.slug,
        plan: 'free',
        defaultTimezone: 'Europe/Berlin',
        defaultCurrency: 'EUR',
      })
      .returning({ id: tenants.id });
    tenantId = t!.id;
    console.log(`+ Created tenant ${tenantId}`);
  }

  // 2. Groups
  const groupIds = new Map<string, string>();
  for (let i = 0; i < GROUPS.length; i++) {
    const g = GROUPS[i]!;
    const existing = await db
      .select({ id: propertyGroups.id })
      .from(propertyGroups)
      .where(and(eq(propertyGroups.tenantId, tenantId), eq(propertyGroups.name, g.name)))
      .limit(1);
    if (existing.length > 0) {
      groupIds.set(g.name, existing[0]!.id);
      console.log(`✓ Group "${g.name}" exists`);
    } else {
      const [row] = await db
        .insert(propertyGroups)
        .values({
          tenantId,
          name: g.name,
          color: g.color,
          sortOrder: (i + 1) * 10,
        })
        .returning({ id: propertyGroups.id });
      groupIds.set(g.name, row!.id);
      console.log(`+ Created group "${g.name}"`);
    }
  }

  // 3. Apartments
  let created = 0,
    skipped = 0;
  for (let i = 0; i < APARTMENTS.length; i++) {
    const a = APARTMENTS[i]!;
    const groupId = groupIds.get(a.group);
    if (!groupId) {
      console.error(`! Group "${a.group}" not found`);
      continue;
    }
    const existing = await db
      .select({ id: properties.id })
      .from(properties)
      .where(and(eq(properties.tenantId, tenantId), eq(properties.name, a.name)))
      .limit(1);
    if (existing.length > 0) {
      skipped++;
      continue;
    }
    await db.insert(properties).values({
      tenantId,
      groupId,
      name: a.name,
      sortOrder: (i + 1) * 10,
    });
    created++;
  }
  console.log(`✓ Apartments: ${created} created, ${skipped} skipped (already existed)`);
  console.log('\nDone.');
} finally {
  await sql.end();
}
