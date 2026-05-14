import { eq, sql } from 'drizzle-orm';
import { bookings, channexProperties, createDb } from '@cm/db';
import { createChannexClient, ChannexError } from '@cm/channex';
import { env } from '../../env';
import { inngest } from '../client';
import { mapChannexBooking } from './channex-booking-mapper';

const FEED_BATCH_SIZE = 50;
const MAX_BATCHES = 5; // safety: ≤ 250 revisions per run

/**
 * Pull unacknowledged Channex booking revisions and persist them.
 *
 * Flow per the Channex best-practices doc:
 *   1. fetch revisions (up to N)
 *   2. for each: map → upsert into bookings (UNIQUE on channex_booking_id)
 *   3. ack the revision only AFTER a successful upsert
 *   4. repeat while the feed keeps returning rows
 *
 * Multi-tenant: revisions span all properties in the Channex account. We
 * resolve tenant_id + property_id per row from channex_properties.
 *
 * Each ack is best-effort; if ack throws, the revision stays in the feed
 * and will be re-ingested next time (booking row is already idempotent).
 *
 * Note: no `sync_jobs` row is written here because this job is account-wide
 * (sync_jobs requires tenant_id NOT NULL). Inngest's own dashboard tracks
 * runs and timings.
 */
export const ingestBookings = inngest.createFunction(
  { id: 'ingest-channex-bookings', name: 'Pull bookings from Channex feed', retries: 3 },
  { event: 'channex/booking.ingest' },
  async ({ event, step, logger }) => {
    const db = createDb(env.DATABASE_URL);

    const channex = createChannexClient({
      baseUrl: env.CHANNEX_API_URL,
      apiKey: env.CHANNEX_API_KEY,
    });

    let totalProcessed = 0;
    let totalSkipped = 0;
    const tenantsTouched = new Set<string>();

    for (let batchNo = 0; batchNo < MAX_BATCHES; batchNo++) {
      // ── Fetch a batch ───────────────────────────────────────────────
      const revisions = await step.run(`fetch-feed-${batchNo}`, async () => {
        try {
          return await channex.bookings.feed.fetch({ limit: FEED_BATCH_SIZE });
        } catch (err) {
          if (err instanceof ChannexError) {
            throw new Error(`Channex feed.fetch failed: ${err.message} (status ${err.status ?? '?'})`);
          }
          throw err;
        }
      });

      if (revisions.length === 0) {
        break;
      }

      // ── Process each revision ───────────────────────────────────────
      for (const rev of revisions) {
        const result = await step.run(`upsert-${rev.id}`, async () => {
          // The feed entries usually carry the full booking inline (`rev.booking`)
          // but per docs we must not trust it — re-fetch by booking_id for
          // authoritative state.
          if (!rev.booking_id) {
            return { skipped: true, reason: 'missing_booking_id' } as const;
          }

          const booking = await (async () => {
            try {
              return await channex.bookings.get(rev.booking_id!);
            } catch (err) {
              if (err instanceof ChannexError && err.status === 404) {
                return null; // booking gone — treat as skipped
              }
              throw err;
            }
          })();
          if (!booking) return { skipped: true, reason: 'booking_not_found' } as const;

          const row = mapChannexBooking(booking, rev.id);
          if (!row.channexPropertyId) {
            return { skipped: true, reason: 'no_channex_property_id' } as const;
          }

          // Resolve our tenant + internal property via the Channex property mapping
          const mapping = (
            await db
              .select({
                tenantId: channexProperties.tenantId,
                channexPropertiesId: channexProperties.id,
              })
              .from(channexProperties)
              .where(eq(channexProperties.channexPropertyId, row.channexPropertyId))
              .limit(1)
          )[0];

          if (!mapping) {
            return { skipped: true, reason: 'channex_property_not_mapped' } as const;
          }

          // Find the internal property linked to this channex_property
          // (1:1 via properties.channex_property_ref)
          const internalProperty = (
            await db.execute<{ id: string }>(sql`
              SELECT id FROM properties
               WHERE tenant_id = ${mapping.tenantId}
                 AND channex_property_ref = ${mapping.channexPropertiesId}
               LIMIT 1
            `)
          )[0];

          if (!internalProperty) {
            return { skipped: true, reason: 'no_internal_property' } as const;
          }

          // ── UPSERT on channex_booking_id ───────────────────────────
          await db
            .insert(bookings)
            .values({
              tenantId: mapping.tenantId,
              propertyId: internalProperty.id,
              source: row.source,
              status: row.status,
              guestName: row.guestName,
              guestPhone: row.guestPhone,
              guestEmail: row.guestEmail,
              guestCountry: row.guestCountry,
              guestCount: row.guestCount,
              checkin: row.checkin,
              checkout: row.checkout,
              priceCents: row.priceCents,
              currency: row.currency,
              channexBookingId: row.channexBookingId,
              channexRevisionId: row.channexRevisionId,
              channexAckedAt: new Date(),
              otaName: row.otaName,
              otaConfirmationCode: row.otaConfirmationCode,
              rawPayload: row.rawPayload as object,
              lastSyncAt: new Date(),
              autoReviewEnabled: row.status === 'cancelled' ? false : true,
            })
            .onConflictDoUpdate({
              target: bookings.channexBookingId,
              set: {
                status: row.status,
                guestName: row.guestName,
                guestPhone: row.guestPhone,
                guestEmail: row.guestEmail,
                guestCountry: row.guestCountry,
                guestCount: row.guestCount,
                checkin: row.checkin,
                checkout: row.checkout,
                priceCents: row.priceCents,
                currency: row.currency,
                channexRevisionId: row.channexRevisionId,
                channexAckedAt: new Date(),
                otaName: row.otaName,
                otaConfirmationCode: row.otaConfirmationCode,
                rawPayload: row.rawPayload as object,
                lastSyncAt: new Date(),
                lastSyncError: null,
                updatedAt: new Date(),
              },
            });

          return { ok: true, tenantId: mapping.tenantId } as const;
        });

        if ('ok' in result) {
          totalProcessed++;
          tenantsTouched.add(result.tenantId);
          // Ack only after a successful upsert
          await step.run(`ack-${rev.id}`, async () => {
            await channex.bookings.feed.ack(rev.id);
          });
        } else {
          totalSkipped++;
          logger.warn(
            { revisionId: rev.id, reason: result.reason },
            'Channex revision skipped',
          );
          // Skip = ack anyway. Otherwise we'd loop forever on a row we
          // can't map. (Could revisit if we want to wait for the mapping.)
          await step.run(`ack-skipped-${rev.id}`, async () => {
            await channex.bookings.feed.ack(rev.id);
          });
        }
      }

      if (revisions.length < FEED_BATCH_SIZE) {
        // Last batch — feed is drained
        break;
      }
    }

    logger.info(
      { processed: totalProcessed, skipped: totalSkipped, tenants: tenantsTouched.size },
      'Channex feed ingest complete.',
    );
    return { processed: totalProcessed, skipped: totalSkipped };
  },
);
