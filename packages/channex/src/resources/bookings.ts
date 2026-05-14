import { z } from 'zod';
import type { ChannexHttpClient } from '../client';
import { envelope } from '../schemas/common';
import { Booking, BookingRevision } from '../schemas/booking';

const ListResponse = envelope(z.array(Booking));
const SingleResponse = envelope(Booking);
const RevisionListResponse = envelope(z.array(BookingRevision));

interface FeedOptions {
  /** Max revisions per call. Channex default 10, max 100. */
  limit?: number;
}

/**
 * Bookings ingestion. The recommended Channex workflow:
 *
 *   1. Receive a webhook → enqueue an "ingest" job
 *   2. Worker calls feed.fetch() → gets unacknowledged revisions
 *   3. For each revision: upsert booking row by channex_booking_id (UNIQUE)
 *   4. Worker calls feed.ack(revisionId) → marks processed
 *
 * Acks must come AFTER successful persistence. The feed guarantees
 * at-least-once delivery; idempotency on our side handles duplicates.
 *
 * https://docs.channex.io/guides/best-practices-guide
 */
export class BookingsAPI {
  constructor(private readonly http: ChannexHttpClient) {}

  /** List bookings via classic pagination. Use for backfills/admin tools. */
  async list(opts?: {
    propertyId?: string;
    fromDate?: string; // YYYY-MM-DD
    toDate?: string;
    page?: number;
    limit?: number;
  }) {
    const raw = await this.http.request({
      method: 'GET',
      path: '/bookings',
      query: {
        'filter[property_id]': opts?.propertyId,
        'filter[arrival_date][gte]': opts?.fromDate,
        'filter[arrival_date][lte]': opts?.toDate,
        'pagination[page]': opts?.page,
        'pagination[limit]': opts?.limit,
      },
    });
    const parsed = ListResponse.parse(raw);
    return { data: parsed.data ?? [], meta: parsed.meta };
  }

  async get(id: string) {
    const raw = await this.http.request({
      method: 'GET',
      path: `/bookings/${id}`,
    });
    return SingleResponse.parse(raw).data!;
  }

  /** Revisions feed — preferred ingestion path. */
  readonly feed = {
    /** Fetch up to `limit` unacknowledged revisions. */
    fetch: async (opts: FeedOptions = {}) => {
      const raw = await this.http.request({
        method: 'GET',
        path: '/booking_revisions/feed',
        query: { limit: opts.limit ?? 10 },
      });
      const parsed = RevisionListResponse.parse(raw);
      return parsed.data ?? [];
    },

    /** Acknowledge a single revision (call AFTER persistence succeeds). */
    ack: async (revisionId: string): Promise<void> => {
      await this.http.request({
        method: 'POST',
        path: `/booking_revisions/${revisionId}/ack`,
        retries: 3, // ack is idempotent — retry safely on transient errors
      });
    },
  };
}
