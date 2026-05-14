import { eq, sql } from 'drizzle-orm';
import type { Database } from '@cm/db';
import { memberships, tenants } from '@cm/db';

interface OnboardInput {
  userId: string;
  email: string;
  tenantName?: string;
}

/**
 * Create a tenant + owner membership for a fresh user. Idempotent: if the
 * user already has a membership, returns the first tenant without creating
 * anything.
 */
export async function onboardNewUser(db: Database, input: OnboardInput) {
  const existing = await db
    .select({ tenantId: memberships.tenantId, role: memberships.role })
    .from(memberships)
    .where(eq(memberships.userId, input.userId))
    .limit(1);

  if (existing.length > 0) {
    return { tenantId: existing[0]!.tenantId, role: existing[0]!.role, created: false };
  }

  const name = input.tenantName?.trim() || defaultTenantName(input.email);
  const slug = await uniqueSlug(db, name);

  const [tenant] = await db
    .insert(tenants)
    .values({ name, slug, plan: 'free', defaultTimezone: 'Europe/Berlin', defaultCurrency: 'EUR' })
    .returning({ id: tenants.id });

  await db.insert(memberships).values({
    tenantId: tenant!.id,
    userId: input.userId,
    role: 'owner',
  });

  return { tenantId: tenant!.id, role: 'owner' as const, created: true };
}

function defaultTenantName(email: string): string {
  const local = email.split('@')[0] ?? 'workspace';
  // "sebastian.teufel.st" → "Sebastian Teufel"
  const pretty = local
    .split('.')
    .slice(0, 2)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
  return `${pretty}'s Workspace`;
}

async function uniqueSlug(db: Database, name: string): Promise<string> {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'workspace';

  // Try base, base-2, base-3, ...
  for (let i = 0; i < 100; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const taken = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(tenants)
      .where(eq(tenants.slug, candidate));
    if ((taken[0]?.c ?? 0) === 0) return candidate;
  }
  // Fallback: append timestamp
  return `${base}-${Date.now()}`;
}
