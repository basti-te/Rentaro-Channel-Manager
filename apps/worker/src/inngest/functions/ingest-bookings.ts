import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { bookings, channexProperties, createDb } from '@cm/db';
import { createChannexClient, ChannexError, type Booking as ChannexBooking } from '@cm/channex';
import { notifyBookingEvent, enqueueAri, type AriChange, type EmailConfig } from '@cm/api';
import { env } from '../../env';
import { inngest } from '../client';
import { mapChannexBooking } from './channex-booking-mapper';

const FEED_BATCH_SIZE = 50;
const MAX_BATCHES = 5; // safety: ≤ 250 revisions per run

/** Smallest [from,to) window covering every given range (from inclusive, to exclusive). */
function unionRange(
  ...pairs: Array<{ from: string; to: string }>
): { from: string; to: string } {
  let from = pairs[0]!.from;
  let to = pairs[0]!.to;
  for (const p of pairs.slice(1)) {
    if (p.from < from) from = p.from;
    if (p.to > to) to = p.to;
  }
  return { from, to };
}

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

    // Operator e-mail notifications (best-effort). Built once; degrades to a
    // silent no-op when RESEND_* aren't set.
    const emailConfig: EmailConfig = {
      apiKey: env.RESEND_API_KEY,
      from: env.RESEND_FROM,
    };

    let totalProcessed = 0;
    let totalSkipped = 0;
    const tenantsTouched = new Set<string>();
    // Availability re-sync windows collected across all revisions, flushed in
    // ONE enqueue at the end (one ari_pending batch insert + one `ari/changed`).
    const ariChanges: AriChange[] = [];

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
          // Each revision carries the full booking shape inside `attributes`.
          // The top-level `id` is the revision id; the booking's own UUID is
          // `attributes.booking_id`. Build a synthetic Booking object so the
          // existing mapper can consume it without a re-fetch.
          const bookingId = rev.attributes.booking_id;
          if (!bookingId) {
            return { skipped: true, reason: 'missing_booking_id' } as const;
          }

          const booking: ChannexBooking = {
            id: bookingId,
            type: 'booking',
            attributes: rev.attributes,
          };

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
            await db.execute<{ id: string; name: string }>(sql`
              SELECT id, name FROM properties
               WHERE tenant_id = ${mapping.tenantId}
                 AND channex_property_ref = ${mapping.channexPropertiesId}
               LIMIT 1
            `)
          )[0];

          if (!internalProperty) {
            return { skipped: true, reason: 'no_internal_property' } as const;
          }

          // Classify the event for the operator notification, comparing
          // against any existing row BEFORE the upsert overwrites it.
          const existing = (
            await db
              .select({
                status: bookings.status,
                channexRevisionId: bookings.channexRevisionId,
                checkin: bookings.checkin,
                checkout: bookings.checkout,
              })
              .from(bookings)
              .where(eq(bookings.channexBookingId, row.channexBookingId))
              .limit(1)
          )[0];

          // Migration-seam reconcile: the FIRST feed delivery for a reservation
          // that was originally IMPORTED (channex_booking_id NULL, e.g.
          // external_id 'guesty:<code>') must ADOPT that row, not insert a
          // duplicate. The stable join key across import + feed is the OTA
          // confirmation code. Scoped to the same tenant + apartment, and only
          // rows that have no Channex id yet, so we can never merge two distinct
          // Channex bookings.
          const adopt =
            !existing && row.otaConfirmationCode
              ? (
                  await db
                    .select({
                      id: bookings.id,
                      checkin: bookings.checkin,
                      checkout: bookings.checkout,
                    })
                    .from(bookings)
                    .where(
                      and(
                        eq(bookings.tenantId, mapping.tenantId),
                        eq(bookings.propertyId, internalProperty.id),
                        eq(bookings.otaConfirmationCode, row.otaConfirmationCode),
                        isNull(bookings.channexBookingId),
                        ne(bookings.status, 'cancelled'),
                      ),
                    )
                    .limit(1)
                )[0]
              : undefined;

          // Same revision id (both present) = idempotent feed re-delivery →
          // don't re-notify. Missing revision ids fall through to normal
          // classification rather than wrongly matching null === null.
          const sameRevision =
            !!existing &&
            !!existing.channexRevisionId &&
            existing.channexRevisionId === row.channexRevisionId;

          let notifyKind:
            | 'new_booking'
            | 'cancellation'
            | 'modification'
            | null = null;
          if (sameRevision) {
            notifyKind = null;
          } else if (row.status === 'cancelled') {
            notifyKind = existing?.status === 'cancelled' ? null : 'cancellation';
          } else if (!existing && !adopt) {
            notifyKind = 'new_booking';
          } else {
            // existing row (matched by channex_booking_id) OR an adopted import
            // → treat as a modification, not a spurious "new booking".
            notifyKind = 'modification';
          }

          // ── Persist ────────────────────────────────────────────────
          if (adopt) {
            // Adopt the imported row in place: attach the Channex ids + the
            // latest OTA data, keeping the original row id (and its links /
            // audit trail). This is what prevents the migration-seam duplicate.
            await db
              .update(bookings)
              .set({
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
                lastSyncError: null,
                updatedAt: new Date(),
              })
              .where(eq(bookings.id, adopt.id));
          } else {
            // New from the feed, or an update of a feed-native row
            // (UPSERT on the UNIQUE channex_booking_id).
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
          }

          // Availability re-sync window: the booked nights, unioned with the
          // PREVIOUS dates on a modification so a shortened stay re-opens the
          // freed nights too. The flusher recomputes occupancy from all active
          // bookings, so this is safe even when ranges overlap other stays.
          const prior = existing ?? adopt;
          const range = prior
            ? unionRange(
                { from: row.checkin, to: row.checkout },
                { from: prior.checkin, to: prior.checkout },
              )
            : { from: row.checkin, to: row.checkout };

          return {
            ok: true,
            tenantId: mapping.tenantId,
            propertyId: internalProperty.id,
            notifyKind,
            // Skip the availability push only for an idempotent same-revision
            // re-delivery (nothing changed). New / modified / cancelled all
            // need Channex's availability re-pushed.
            enqueueAvailability: !sameRevision,
            range,
            booking: {
              apartmentName: internalProperty.name,
              guestName: row.guestName,
              checkin: row.checkin,
              checkout: row.checkout,
              otaName: row.otaName,
              otaConfirmationCode: row.otaConfirmationCode,
            },
          } as const;
        });

        if ('ok' in result) {
          totalProcessed++;
          tenantsTouched.add(result.tenantId);
          // Queue the availability re-push for this booking's nights. THIS is
          // what was missing: without it an inbound OTA booking only blocked
          // the other channels on the next manual Full Sync (the cron is
          // delta-only and had no pending row to drain).
          if (result.enqueueAvailability) {
            ariChanges.push({
              tenantId: result.tenantId,
              propertyId: result.propertyId,
              kinds: ['availability'],
              from: result.range.from,
              to: result.range.to,
              reason: `ota.${result.notifyKind ?? 'resync'}`,
            });
          }
          // Ack only after a successful upsert
          await step.run(`ack-${rev.id}`, async () => {
            await channex.bookings.feed.ack(rev.id);
          });
          // Operator notification — its own durable step so a mail hiccup
          // never re-runs the upsert/ack. notifyBookingEvent never throws.
          const kind = result.notifyKind;
          if (kind) {
            await step.run(`notify-${rev.id}`, async () => {
              const outcome = await notifyBookingEvent(db, emailConfig, {
                tenantId: result.tenantId,
                kind,
                booking: result.booking,
              });
              if (!outcome.sent && outcome.reason === 'error') {
                logger.warn(
                  { revisionId: rev.id, error: outcome.message },
                  'Booking notification failed to send',
                );
              }
              return outcome;
            });
          }
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

    // Push availability for every booked/changed range in one batched enqueue.
    // The global flusher (debounced 8s, throttled) coalesces it into ~1 Channex
    // /availability call regardless of how many bookings arrived.
    if (ariChanges.length > 0) {
      await step.run('enqueue-availability', async () => {
        await enqueueAri({ db, inngest }, ariChanges);
        return { enqueued: ariChanges.length };
      });
    }

    logger.info(
      {
        processed: totalProcessed,
        skipped: totalSkipped,
        tenants: tenantsTouched.size,
        availabilityRanges: ariChanges.length,
      },
      'Channex feed ingest complete.',
    );
    return { processed: totalProcessed, skipped: totalSkipped, availabilityRanges: ariChanges.length };
  },
);
