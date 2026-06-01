import { eq, sql } from 'drizzle-orm';
import type { Database } from '@cm/db';
import { memberships, subscriptions, tenants } from '@cm/db';
import { TRIAL_DAYS } from './stripe';

interface OnboardInput {
  userId: string;
  email: string;
  tenantName?: string;
}

/**
 * Create a tenant + owner membership for a fresh user. Idempotent: if the
 * user already has a membership, returns the first tenant without creating
 * anything.
 *
 * Race-safe: the whole check-then-create runs inside a transaction guarded
 * by a per-user transaction-scoped advisory lock. Without it, two bootstrap
 * calls firing near-simultaneously (double-mounted effect, two tabs) both
 * pass the "no membership" check and create duplicate tenants. The advisory
 * lock serialises concurrent onboarding for the same user; it is
 * transaction-scoped, so it works through the Supabase transaction pooler.
 */
export async function onboardNewUser(db: Database, input: OnboardInput) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${input.userId})::bigint)`,
    );

    const existing = await tx
      .select({
        tenantId: memberships.tenantId,
        role: memberships.role,
        name: tenants.name,
      })
      .from(memberships)
      .leftJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(eq(memberships.userId, input.userId))
      .limit(1);

    if (existing.length > 0) {
      return {
        tenantId: existing[0]!.tenantId,
        role: existing[0]!.role,
        name: existing[0]!.name ?? '',
        created: false as const,
      };
    }

    const name = input.tenantName?.trim() || defaultTenantName(input.email);
    const slug = await uniqueSlug(db, name);

    const [tenant] = await tx
      .insert(tenants)
      .values({ name, slug, plan: 'free', defaultTimezone: 'Europe/Berlin', defaultCurrency: 'EUR' })
      .returning({ id: tenants.id });

    await tx.insert(memberships).values({
      tenantId: tenant!.id,
      userId: input.userId,
      role: 'owner',
    });

    // Start the local 14-day trial. No Stripe subscription yet — that's
    // created when the user picks a plan in /settings/billing. The plan
    // guard reads this row; new tenants pass the gate via status='trialing'
    // until trialEndsAt elapses.
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86_400_000);
    await tx.insert(subscriptions).values({
      tenantId: tenant!.id,
      plan: 'free',
      status: 'trialing',
      quantity: 1,
      trialEndsAt,
    });

    return { tenantId: tenant!.id, role: 'owner' as const, name, created: true as const };
  });
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
