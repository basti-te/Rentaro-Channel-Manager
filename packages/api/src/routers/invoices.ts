import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { tenantInvoiceSettings } from '@cm/db';
import { router, tenantProcedure, adminProcedure, editorProcedure } from '../trpc';
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
});
