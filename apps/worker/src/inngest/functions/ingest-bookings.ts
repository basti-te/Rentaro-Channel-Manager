import { and, eq, isNull, ne, or, sql } from 'drizzle-orm';
import { bookings, channexProperties, properties, createDb } from '@cm/db';
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
  {
    id: 'ingest-channex-bookings',
    name: 'Pull bookings from Channex feed',
    retries: 3,
    // Serialize feed drains so a webhook and the safety-net cron can't
    // double-process / double-ack the same revisions concurrently.
    concurrency: { limit: 1 },
  },
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

      // Acks made in this batch. If a batch acks nothing (everything left
      // unacked for the operator to map), re-fetching returns the identical
      // set — so we stop instead of spinning MAX_BATCHES times.
      let ackedThisBatch = 0;

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

          // ── Cancellations handled up front ─────────────────────────────
          // A cancellation can carry NULL dates (the mapper would throw) and
          // can target an IMPORTED row whose channex_booking_id is still NULL —
          // so it must be matched by the OTA confirmation code, not only the
          // Channex booking id. Cancel every active row for the reservation and
          // free its nights. (2026-06-01 incident: the import's cancellation
          // never landed because we matched on channex_booking_id alone.)
          if (rev.attributes.status === 'cancelled') {
            const otaCode =
              rev.attributes.ota_reservation_code ?? rev.attributes.unique_id ?? null;
            const idMatch = otaCode
              ? or(
                  eq(bookings.channexBookingId, bookingId),
                  eq(bookings.otaConfirmationCode, otaCode),
                )
              : eq(bookings.channexBookingId, bookingId);
            const target = (
              await db
                .select({
                  tenantId: bookings.tenantId,
                  propertyId: bookings.propertyId,
                  propName: properties.name,
                  checkin: bookings.checkin,
                  checkout: bookings.checkout,
                  guestName: bookings.guestName,
                  otaName: bookings.otaName,
                  otaConfirmationCode: bookings.otaConfirmationCode,
                })
                .from(bookings)
                .leftJoin(properties, eq(properties.id, bookings.propertyId))
                .where(and(idMatch, ne(bookings.status, 'cancelled')))
                .limit(1)
            )[0];
            if (!target) {
              // Nothing active to cancel (never held it, or already cancelled).
              return { skipped: true, reason: 'cancel_no_target' } as const;
            }
            // Cancel ALL active rows for this reservation (handles a legacy
            // import+feed duplicate), then free the nights.
            await db
              .update(bookings)
              .set({ status: 'cancelled', channexRevisionId: rev.id, lastSyncAt: new Date(), updatedAt: new Date() })
              .where(and(idMatch, ne(bookings.status, 'cancelled')));
            return {
              ok: true,
              tenantId: target.tenantId,
              propertyId: target.propertyId,
              notifyKind: 'cancellation' as const,
              enqueueAvailability: true,
              range: { from: target.checkin, to: target.checkout },
              booking: {
                apartmentName: target.propName ?? '—',
                guestName: target.guestName,
                checkin: target.checkin,
                checkout: target.checkout,
                otaName: target.otaName,
                otaConfirmationCode: target.otaConfirmationCode,
              },
            } as const;
          }

          const booking: ChannexBooking = {
            id: bookingId,
            type: 'booking',
            attributes: rev.attributes,
          };

          let row: ReturnType<typeof mapChannexBooking>;
          try {
            row = mapChannexBooking(booking, rev.id);
          } catch (err) {
            // NEVER rethrow: a throw here fails the whole run and blocks every
            // revision behind it in the feed (head-of-line — the 2026-06-01
            // incident). Cancellations are handled above; a non-cancel revision
            // we can't map (e.g. missing dates) is skipped + acked.
            return {
              skipped: true,
              reason: `map_error:${err instanceof Error ? err.message : String(err)}`,
            } as const;
          }
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
          ackedThisBatch++;
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
          // FIXABLE mapping gaps (apartment not mapped yet / no internal
          // property) are left UNACKED so the booking is NOT silently lost:
          // once the operator maps the apartment, the safety-net cron re-drains
          // it, and Channex's own "unacked" reminder surfaces it. Everything
          // else (can-never-process: no booking_id, no property_id in payload,
          // map error, dateless cancellation) is acked so the feed can't wedge.
          const fixable =
            result.reason === 'channex_property_not_mapped' ||
            result.reason === 'no_internal_property';
          if (!fixable) {
            await step.run(`ack-skipped-${rev.id}`, async () => {
              await channex.bookings.feed.ack(rev.id);
            });
            ackedThisBatch++;
          }
        }
      }

      // Nothing acked this batch → only unmappable revisions remain; the next
      // fetch would return the same set. Stop; the cron retries later.
      if (ackedThisBatch === 0) break;

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

/**
 * Safety-net: pull the booking feed every 5 minutes regardless of webhooks.
 * Webhooks are the primary trigger, but Channex's own docs warn they can be
 * missed or arrive out of order — without this, a missed/failed webhook means
 * a booking is never ingested until some later unrelated webhook fires (the
 * 2026-06-01 incident). Re-uses the same idempotent, concurrency-limited
 * ingest function via its event, so this is just a periodic nudge.
 */
export const ingestBookingsCron = inngest.createFunction(
  { id: 'ingest-channex-bookings-cron', name: 'Booking feed safety-net drain', retries: 1 },
  { cron: '*/5 * * * *' },
  async ({ step }) => {
    await step.run('kick-ingest', async () => {
      await inngest.send({
        name: 'channex/booking.ingest',
        data: { reason: 'cron.safety' },
      });
      return { sent: true };
    });
    return { triggered: true };
  },
);
