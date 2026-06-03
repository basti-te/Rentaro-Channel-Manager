import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { tenantSmsCountries } from '@cm/db';
import { router, tenantProcedure, adminProcedure } from '../trpc';
import {
  SMS_RATES,
  SMS_MARKUP,
  smsCustomerPriceMinor,
} from '../services/sms-rates';

/**
 * SMS country allow-list + price overview.
 *
 * SMS to a country is only sent if the tenant has ticked it here (and the
 * operator has enabled it at Twilio — that account-wide list is the ceiling).
 * Prices are the customer price per segment (Twilio cost × FX × markup), in
 * EUR minor units, so the UI can show an honest per-country price list.
 */
export const smsRouter = router({
  /** Full country list with per-segment customer price + this tenant's choices. */
  countries: tenantProcedure.query(async ({ ctx }) => {
    const allowed = new Set(
      (
        await ctx.db
          .select({ c: tenantSmsCountries.countryCode })
          .from(tenantSmsCountries)
          .where(eq(tenantSmsCountries.tenantId, ctx.tenantId!))
      ).map((r) => r.c),
    );
    const countries = Object.entries(SMS_RATES)
      .map(([code, r]) => ({
        code,
        name: r.name,
        priceMinor: smsCustomerPriceMinor(code) ?? 0,
        allowed: allowed.has(code),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { currency: 'EUR' as const, markup: SMS_MARKUP, countries };
  }),

  /** Replace the tenant's allowed-country set (admin). Unknown codes ignored. */
  setAllowedCountries: adminProcedure
    .input(z.object({ codes: z.array(z.string().regex(/^[A-Z]{2}$/)).max(300) }))
    .mutation(async ({ ctx, input }) => {
      const valid = [...new Set(input.codes)].filter((c) => c in SMS_RATES);
      await ctx.db.transaction(async (tx) => {
        await tx
          .delete(tenantSmsCountries)
          .where(eq(tenantSmsCountries.tenantId, ctx.tenantId!));
        if (valid.length > 0) {
          await tx.insert(tenantSmsCountries).values(
            valid.map((countryCode) => ({ tenantId: ctx.tenantId!, countryCode })),
          );
        }
      });
      return { count: valid.length };
    }),
});
