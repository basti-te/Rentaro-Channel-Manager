import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { channexProperties, properties } from '@cm/db';
import { createChannexClient, ChannexError } from '@cm/channex';
import { router, editorProcedure } from '../trpc';

/**
 * Channex iframe path for the guest-messaging screen. The mapping iframe
 * uses `/channels`; messaging is `/messages`. Kept as a constant so it's
 * easy to adjust once verified against the sandbox (requires the Channex
 * "Messages app" installed on the property).
 */
const CHANNEX_MESSAGES_PATH = '/messages';

export const messagesRouter = router({
  /**
   * Mint a short-lived Channex one-time token server-side and return the
   * ready-to-embed iframe URL for a property's guest inbox.
   *
   * The API key never reaches the browser — only the single-use OTT does,
   * inside the iframe `oauth_session_key`. Token TTL 15 min; once the iframe
   * loads Channex exchanges it for a session with no further expiry.
   */
  iframeSession: editorProcedure
    .input(z.object({ propertyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Resolve the Channex property UUID for this internal property,
      // scoped to the caller's tenant.
      const mapping = (
        await ctx.db
          .select({ channexPropertyId: channexProperties.channexPropertyId })
          .from(properties)
          .innerJoin(
            channexProperties,
            eq(properties.channexPropertyRef, channexProperties.id),
          )
          .where(
            and(
              eq(properties.id, input.propertyId),
              eq(properties.tenantId, ctx.tenantId!),
            ),
          )
          .limit(1)
      )[0];

      if (!mapping) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Property is not connected to Channex',
        });
      }

      const channex = createChannexClient({
        baseUrl: ctx.env.CHANNEX_API_URL,
        apiKey: ctx.env.CHANNEX_API_KEY,
      });

      let token: string;
      try {
        token = await channex.auth.createOneTimeToken({
          propertyId: mapping.channexPropertyId,
          username: ctx.userEmail ?? `tenant:${ctx.tenantId}`,
        });
      } catch (err) {
        if (err instanceof ChannexError) {
          throw new TRPCError({
            code: 'BAD_GATEWAY',
            message:
              `Channex one_time_token failed (${err.status ?? '?'}): ${err.message}. ` +
              'Ist die Channex "Messages app" auf dieser Property installiert?',
          });
        }
        throw err;
      }

      // The iframe lives on the Channex app origin, NOT the /api/v1 base.
      const appOrigin = new URL(ctx.env.CHANNEX_API_URL).origin;
      const url =
        `${appOrigin}/auth/exchange` +
        `?oauth_session_key=${encodeURIComponent(token)}` +
        `&app_mode=headless` +
        `&redirect_to=${encodeURIComponent(CHANNEX_MESSAGES_PATH)}` +
        `&property_id=${encodeURIComponent(mapping.channexPropertyId)}`;

      return { url };
    }),
});
