import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, asc, eq, max } from 'drizzle-orm';
import { properties, propertyGroups, channexProperties, tenants } from '@cm/db';
import { createChannexClient, ChannexError } from '@cm/channex';
import { router, tenantProcedure, editorProcedure } from '../trpc';
import { enqueueAri } from '../services/ari';

export const propertiesRouter = router({
  list: tenantProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        property: properties,
        group: propertyGroups,
      })
      .from(properties)
      .leftJoin(propertyGroups, eq(propertyGroups.id, properties.groupId))
      .where(eq(properties.tenantId, ctx.tenantId!))
      .orderBy(
        asc(propertyGroups.sortOrder),
        asc(properties.sortOrder),
        asc(properties.name),
      );

    return rows.map((r) => ({
      ...r.property,
      group: r.group,
    }));
  }),

  create: editorProcedure
    .input(
      z.object({
        name: z.string().min(1).max(80).trim(),
        groupId: z.string().uuid().nullable(),
        description: z.string().max(2000).optional(),
        /** ISO 4217 (e.g. "USD"). Omit/null = inherit tenant default. */
        currency: z
          .string()
          .trim()
          .regex(/^[A-Z]{3}$/, 'ISO-4217-Code, z. B. EUR')
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Ensure group, if given, belongs to this tenant
      if (input.groupId) {
        const exists = await ctx.db
          .select({ id: propertyGroups.id })
          .from(propertyGroups)
          .where(
            and(eq(propertyGroups.id, input.groupId), eq(propertyGroups.tenantId, ctx.tenantId!)),
          )
          .limit(1);
        if (exists.length === 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Group not in tenant' });
        }
      }

      const maxRow = await ctx.db
        .select({ m: max(properties.sortOrder) })
        .from(properties)
        .where(eq(properties.tenantId, ctx.tenantId!));
      const nextOrder = (maxRow[0]?.m ?? 0) + 10;

      const [row] = await ctx.db
        .insert(properties)
        .values({
          tenantId: ctx.tenantId!,
          name: input.name,
          groupId: input.groupId,
          description: input.description,
          currency: input.currency ?? null,
          sortOrder: nextOrder,
        })
        .returning();
      return row;
    }),

  update: editorProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(80).trim().optional(),
        groupId: z.string().uuid().nullable().optional(),
        description: z.string().max(2000).optional(),
        active: z.boolean().optional(),
        defaultRateCents: z.number().int().nonnegative().nullable().optional(),
        defaultMinStay: z.number().int().min(1).max(60).optional(),
        /**
         * ISO 4217 currency override for this apartment. `null` clears it
         * (reverts to tenant default). Changing currency on a connected
         * apartment does NOT retro-update Channex — re-onboarding is the
         * clean path if you need that.
         */
        currency: z
          .string()
          .trim()
          .regex(/^[A-Z]{3}$/, 'ISO-4217-Code, z. B. EUR')
          .nullable()
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, defaultRateCents, ...rest } = input;
      const patch = {
        ...rest,
        ...(defaultRateCents !== undefined && {
          defaultRateCents: defaultRateCents === null ? null : BigInt(defaultRateCents),
        }),
      };
      const [row] = await ctx.db
        .update(properties)
        .set(patch)
        .where(and(eq(properties.id, id), eq(properties.tenantId, ctx.tenantId!)))
        .returning();
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });

      // Rate or min-stay touched? Enqueue a rates change over the next ~6
      // months; the global flusher batches it with everything else.
      if (input.defaultRateCents !== undefined || input.defaultMinStay !== undefined) {
        const today = new Date();
        const from = today.toISOString().slice(0, 10);
        const toDate = new Date(today);
        toDate.setUTCDate(toDate.getUTCDate() + 180);
        await enqueueAri(ctx, {
          tenantId: ctx.tenantId!,
          propertyId: id,
          kinds: ['rates'],
          from,
          to: toDate.toISOString().slice(0, 10),
          reason: 'property.updated',
        });
      }

      return row;
    }),

  /**
   * Set or clear the public OTA listing URLs shown on the Listing-Links page.
   * Pass a URL to set, `null` to clear, or omit a field to leave it unchanged.
   */
  setListingLinks: editorProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        airbnbListingUrl: z.string().trim().url().max(2000).nullable().optional(),
        bookingListingUrl: z.string().trim().url().max(2000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const patch: {
        airbnbListingUrl?: string | null;
        bookingListingUrl?: string | null;
        updatedAt: Date;
      } = { updatedAt: new Date() };
      if (input.airbnbListingUrl !== undefined) patch.airbnbListingUrl = input.airbnbListingUrl;
      if (input.bookingListingUrl !== undefined) patch.bookingListingUrl = input.bookingListingUrl;
      if (Object.keys(patch).length === 1) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Nichts zu ändern' });
      }
      const [row] = await ctx.db
        .update(properties)
        .set(patch)
        .where(and(eq(properties.id, input.id), eq(properties.tenantId, ctx.tenantId!)))
        .returning();
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return row;
    }),

  delete: editorProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db
        .delete(properties)
        .where(and(eq(properties.id, input.id), eq(properties.tenantId, ctx.tenantId!)))
        .returning({ id: properties.id });
      if (result.length === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { id: input.id };
    }),

  reorder: editorProcedure
    .input(z.object({ orderedIds: z.array(z.string().uuid()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction(async (tx) => {
        for (let i = 0; i < input.orderedIds.length; i++) {
          await tx
            .update(properties)
            .set({ sortOrder: (i + 1) * 10 })
            .where(
              and(
                eq(properties.id, input.orderedIds[i]!),
                eq(properties.tenantId, ctx.tenantId!),
              ),
            );
        }
      });
      return { ok: true };
    }),

  /**
   * Connect an apartment to Channex by creating a Property, Room Type and
   * Rate Plan there, then linking everything together in our DB.
   *
   * Failure modes:
   *   - Apartment already mapped → 400
   *   - Channex Property succeeds but Room Type fails → orphan in Channex,
   *     no DB state. User can retry; would create another Channex Property.
   *     We accept that small risk for MVP simplicity.
   *
   * On success, queues an initial availability + rates sync so the new
   * channel has correct data immediately.
   */
  onboardToChannex: editorProcedure
    .input(
      z.object({
        propertyId: z.string().uuid(),
        /** Override defaults; otherwise we use the apartment name + tenant defaults. */
        title: z.string().min(1).max(80).optional(),
        timezone: z.string().optional(),
        currency: z.string().length(3).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 1. Load apartment + verify it isn't already linked
      const prop = (
        await ctx.db
          .select()
          .from(properties)
          .where(and(eq(properties.id, input.propertyId), eq(properties.tenantId, ctx.tenantId!)))
          .limit(1)
      )[0];
      if (!prop) throw new TRPCError({ code: 'NOT_FOUND' });
      if (prop.channexPropertyRef) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Apartment ist bereits mit Channex verbunden.',
        });
      }

      const tenant = (
        await ctx.db
          .select({
            defaultTimezone: tenants.defaultTimezone,
            defaultCurrency: tenants.defaultCurrency,
          })
          .from(tenants)
          .where(eq(tenants.id, ctx.tenantId!))
          .limit(1)
      )[0]!;

      const title = input.title ?? prop.name;
      const timezone = input.timezone ?? tenant.defaultTimezone;
      // Priority: explicit override → property-level setting → tenant default.
      const currency = input.currency ?? prop.currency ?? tenant.defaultCurrency;

      // 2. Call Channex (3 sequential creates)
      const channex = createChannexClient({
        baseUrl: ctx.env.CHANNEX_API_URL,
        apiKey: ctx.env.CHANNEX_API_KEY,
      });

      let channexProp;
      let channexRoom;
      let channexRate;
      try {
        channexProp = await channex.properties.create({
          title,
          currency,
          timezone,
          property_type: 'apartment',
        });
        channexRoom = await channex.roomTypes.create({
          property_id: channexProp.id,
          title: 'Apartment',
          count_of_rooms: 1,
          occ_adults: 2,
          occ_children: 0,
          occ_infants: 0,
        });
        channexRate = await channex.ratePlans.create({
          property_id: channexProp.id,
          room_type_id: channexRoom.id,
          title: 'Standard',
          currency,
          sell_mode: 'per_room',
          rate_mode: 'manual',
        });
      } catch (err) {
        if (err instanceof ChannexError) {
          const detail = err.payload
            ? ` — ${JSON.stringify(err.payload).slice(0, 400)}`
            : '';
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `Channex-Anlage fehlgeschlagen (HTTP ${err.status ?? '?'})${detail}`,
          });
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Channex-Anlage fehlgeschlagen: ${String(err)}`,
        });
      }

      // 3. Persist mapping in a transaction
      const channexRowId = await ctx.db.transaction(async (tx) => {
        const [cp] = await tx
          .insert(channexProperties)
          .values({
            tenantId: ctx.tenantId!,
            channexPropertyId: channexProp.id,
            channexRoomTypeId: channexRoom.id,
            channexRatePlanId: channexRate.id,
            timezone,
            currency,
          })
          .returning({ id: channexProperties.id });
        if (!cp) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

        await tx
          .update(properties)
          .set({ channexPropertyRef: cp.id, updatedAt: new Date() })
          .where(eq(properties.id, input.propertyId));
        return cp.id;
      });

      // 4. Queue initial availability + rates sync over the next 180 days
      const today = new Date();
      const from = today.toISOString().slice(0, 10);
      const toDate = new Date(today);
      toDate.setUTCDate(toDate.getUTCDate() + 180);
      await enqueueAri(ctx, {
        tenantId: ctx.tenantId!,
        propertyId: input.propertyId,
        kinds: ['availability', 'rates'],
        from,
        to: toDate.toISOString().slice(0, 10),
        reason: 'onboarding.initial',
      });

      return {
        channexPropertyRef: channexRowId,
        channexPropertyId: channexProp.id,
        channexRoomTypeId: channexRoom.id,
        channexRatePlanId: channexRate.id,
      };
    }),
});
