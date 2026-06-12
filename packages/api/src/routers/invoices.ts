import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, eq, ne } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { bookings, guestInvoices, tenantInvoiceSettings, type Database } from '@cm/db';
import {
  router,
  tenantProcedure,
  adminProcedure,
  editorProcedure,
  publicProcedure,
} from '../trpc';
import {
  previewInvoice,
  issueInvoiceForBooking,
  InvoiceIssueError,
} from '../services/invoice-issue';

const recipientInput = z.object({
  company: z.string().trim().max(160).optional(),
  name: z.string().trim().min(1).max(160),
  street: z.string().trim().min(1).max(200),
  zip: z.string().trim().min(1).max(20),
  city: z.string().trim().min(1).max(120),
  country: z.string().trim().max(80).optional(),
  vatId: z.string().trim().max(40).optional(),
  email: z.string().trim().email().max(180).optional().or(z.literal('')),
});

const settingsInput = z.object({
  enabled: z.boolean().optional(),
  issuerName: z.string().max(200).optional(),
  issuerAddress: z.string().max(500).optional(),
  senderLine: z.string().max(200).optional(),
  logoText: z.string().max(120).optional(),
  contactPerson: z.string().max(160).optional(),
  taxId: z.string().max(40).optional(),
  taxNumber: z.string().max(40).optional(),
  vatMode: z.enum(['regular', 'kleinunternehmer']).optional(),
  vatRateBp: z.number().int().min(0).max(2500).optional(),
  cityTaxRateBp: z.number().int().min(0).max(2500).optional(),
  lodgingLabel: z.string().max(80).optional(),
  cityTaxLabel: z.string().max(80).optional(),
  cleaningLabel: z.string().max(80).optional(),
  numberPrefix: z.string().max(20).optional(),
  nextSeq: z.number().int().min(1).max(99_999_999).optional(),
  footerContact: z.string().max(400).optional(),
  footerRegistry: z.string().max(400).optional(),
  footerBank: z.string().max(400).optional(),
  closingNote: z.string().max(500).optional(),
  publicSlug: z.string().trim().min(8).max(64).optional(),
  lookupRequireCode: z.boolean().optional(),
});

// ── Public lookup (unauthenticated) ──────────────────────────────────────────
// In-memory per-portal rate limit. The worker is single-instance, so this is a
// sufficient backstop against name+date guessing; generic errors never reveal
// whether the name or the dates were wrong (no enumeration).
const attempts = new Map<string, { count: number; resetAt: number }>();
function rateLimit(key: string, max = 20, windowMs = 600_000): boolean {
  const now = Date.now();
  const e = attempts.get(key);
  if (!e || e.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (e.count >= max) return false;
  e.count += 1;
  return true;
}

const lookupInput = z.object({
  slug: z.string().min(8).max(64),
  lastName: z.string().trim().min(2).max(120),
  checkin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkout: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  code: z.string().trim().max(60).optional(),
});

/**
 * Resolve a booking from a public lookup. Requires the portal slug (→ tenant) +
 * the last name as a substring of the guest name + BOTH dates exact, and the OTA
 * code when the tenant requires it. Returns null on no match OR ambiguity (never
 * leaks which field was wrong).
 */
async function resolvePublicBooking(db: Database, input: z.infer<typeof lookupInput>) {
  const settings = (
    await db
      .select({
        tenantId: tenantInvoiceSettings.tenantId,
        requireCode: tenantInvoiceSettings.lookupRequireCode,
      })
      .from(tenantInvoiceSettings)
      .where(
        and(
          eq(tenantInvoiceSettings.publicSlug, input.slug),
          eq(tenantInvoiceSettings.enabled, true),
        ),
      )
      .limit(1)
  )[0];
  if (!settings) return null;

  const rows = await db
    .select({
      id: bookings.id,
      guestName: bookings.guestName,
      code: bookings.otaConfirmationCode,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.tenantId, settings.tenantId),
        eq(bookings.checkin, input.checkin),
        eq(bookings.checkout, input.checkout),
        ne(bookings.status, 'cancelled'),
        ne(bookings.source, 'block'),
      ),
    );

  const ln = input.lastName.toLowerCase();
  let matches = rows.filter((r) => (r.guestName ?? '').toLowerCase().includes(ln));
  if (settings.requireCode) {
    const code = (input.code ?? '').toLowerCase();
    matches = code ? matches.filter((r) => (r.code ?? '').toLowerCase() === code) : [];
  }
  if (matches.length !== 1) return null;
  return { tenantId: settings.tenantId, bookingId: matches[0]!.id, guestName: matches[0]!.guestName };
}

export const invoicesRouter = router({
  /** Operator config (null until first save). */
  settings: tenantProcedure.query(async ({ ctx }) => {
    return (
      (
        await ctx.db
          .select()
          .from(tenantInvoiceSettings)
          .where(eq(tenantInvoiceSettings.tenantId, ctx.tenantId!))
          .limit(1)
      )[0] ?? null
    );
  }),

  setSettings: adminProcedure.input(settingsInput).mutation(async ({ ctx, input }) => {
    // Build a patch of only the provided keys.
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if (v !== undefined) patch[k] = v;
    }

    const existing = (
      await ctx.db
        .select({ publicSlug: tenantInvoiceSettings.publicSlug })
        .from(tenantInvoiceSettings)
        .where(eq(tenantInvoiceSettings.tenantId, ctx.tenantId!))
        .limit(1)
    )[0];

    // Auto-generate a portal slug the first time the feature is enabled.
    if (input.enabled && !existing?.publicSlug && !input.publicSlug) {
      patch.publicSlug = randomBytes(16).toString('base64url');
    }

    await ctx.db
      .insert(tenantInvoiceSettings)
      .values({ tenantId: ctx.tenantId!, ...patch })
      .onConflictDoUpdate({
        target: tenantInvoiceSettings.tenantId,
        set: { ...patch, updatedAt: new Date() },
      });

    return (
      await ctx.db
        .select()
        .from(tenantInvoiceSettings)
        .where(eq(tenantInvoiceSettings.tenantId, ctx.tenantId!))
        .limit(1)
    )[0]!;
  }),

  /** Upload / replace / clear the invoice logo (base64 data URL, PNG/JPEG). */
  setLogo: adminProcedure
    .input(z.object({ logoImageData: z.string().max(1_400_000).nullable() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(tenantInvoiceSettings)
        .values({ tenantId: ctx.tenantId!, logoImageData: input.logoImageData })
        .onConflictDoUpdate({
          target: tenantInvoiceSettings.tenantId,
          set: { logoImageData: input.logoImageData, updatedAt: new Date() },
        });
      return { ok: true };
    }),

  /** What the invoice would look like for a booking (or the issued one). */
  forBooking: tenantProcedure
    .input(z.object({ bookingId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return previewInvoice(ctx.db, ctx.tenantId!, input.bookingId);
    }),

  /** Issue (or fetch the existing) invoice — operator-side generation. */
  issue: editorProcedure
    .input(z.object({ bookingId: z.string().uuid(), recipient: recipientInput }))
    .mutation(async ({ ctx, input }) => {
      try {
        const inv = await issueInvoiceForBooking(ctx.db, ctx.tenantId!, input.bookingId, {
          ...input.recipient,
          email: input.recipient.email || null,
        });
        return { number: inv.number, token: inv.token };
      } catch (e) {
        if (e instanceof InvoiceIssueError) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: e.reason });
        }
        throw e;
      }
    }),

  /** Operator override of the invoice amounts (gross total + cleaning), per
   *  booking. Persisted → the guest portal uses them too. null clears. */
  setOverrides: editorProcedure
    .input(
      z.object({
        bookingId: z.string().uuid(),
        grossCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
        cleaningCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.grossCents !== undefined)
        patch.invoiceGrossOverrideCents =
          input.grossCents == null ? null : BigInt(input.grossCents);
      if (input.cleaningCents !== undefined)
        patch.invoiceCleaningOverrideCents =
          input.cleaningCents == null ? null : BigInt(input.cleaningCents);
      const [row] = await ctx.db
        .update(bookings)
        .set(patch)
        .where(and(eq(bookings.id, input.bookingId), eq(bookings.tenantId, ctx.tenantId!)))
        .returning({ id: bookings.id });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true };
    }),

  /** Storno: void an issued invoice. Frees the booking for a corrected re-issue. */
  voidInvoice: adminProcedure
    .input(z.object({ invoiceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(guestInvoices)
        .set({ status: 'void', updatedAt: new Date() })
        .where(
          and(
            eq(guestInvoices.id, input.invoiceId),
            eq(guestInvoices.tenantId, ctx.tenantId!),
          ),
        )
        .returning({ id: guestInvoices.id });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true };
    }),

  // ── Public portal (no auth) ──────────────────────────────────────────────
  publicLookup: publicProcedure.input(lookupInput).mutation(async ({ ctx, input }) => {
    if (!rateLimit(`lookup:${input.slug}`)) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: 'Zu viele Versuche. Bitte später erneut.',
      });
    }
    const m = await resolvePublicBooking(ctx.db, input);
    if (!m) return { found: false as const };
    const p = await previewInvoice(ctx.db, m.tenantId, m.bookingId);
    return {
      found: true as const,
      guestName: m.guestName,
      apartmentName: p.apartmentName,
      nights: p.nights,
      currency: p.currency,
      confident: p.confident,
      grossCents: p.breakdown?.totalGrossCents ?? null,
      existing: p.existing,
    };
  }),

  publicIssue: publicProcedure
    .input(lookupInput.extend({ recipient: recipientInput }))
    .mutation(async ({ ctx, input }) => {
      if (!rateLimit(`issue:${input.slug}`)) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: 'Zu viele Versuche. Bitte später erneut.',
        });
      }
      const m = await resolvePublicBooking(ctx.db, input);
      if (!m) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Keine passende Buchung gefunden.' });
      }
      try {
        const inv = await issueInvoiceForBooking(ctx.db, m.tenantId, m.bookingId, {
          ...input.recipient,
          email: input.recipient.email || null,
        });
        return { token: inv.token, number: inv.number };
      } catch (e) {
        if (e instanceof InvoiceIssueError) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: e.reason });
        }
        throw e;
      }
    }),
});
