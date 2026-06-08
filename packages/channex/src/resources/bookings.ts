import { z } from 'zod';
import type { ChannexHttpClient } from '../client';
import { envelope } from '../schemas/common';
import { Booking, BookingCreate, BookingRevision } from '../schemas/booking';
import { ChannexMessage } from '../schemas/message';

const ListResponse = envelope(z.array(Booking));
const SingleResponse = envelope(Booking);
const RevisionListResponse = envelope(z.array(BookingRevision));
const MessageListResponse = envelope(z.array(ChannexMessage));

/** Expand [arrival, departure) into one entry per night with the given rate. */
function buildDaysMap(arrival: string, departure: string, rate: string): Record<string, string> {
  const out: Record<string, string> = {};
  const a = new Date(`${arrival}T00:00:00Z`);
  const d = new Date(`${departure}T00:00:00Z`);
  for (let t = a.getTime(); t < d.getTime(); t += 86400000) {
    out[new Date(t).toISOString().slice(0, 10)] = rate;
  }
  return out;
}

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

  /**
   * Send a guest message into a booking's OTA thread (Airbnb / Booking.com
   * / Expedia) via the Channex Messages app. Requires the Messages app
   * installed on the property and an active messaging-capable channel —
   * otherwise Channex returns an error (surfaced to the caller).
   *
   * https://docs.channex.io/api-v.1-documentation/messages-collection
   */
  async sendMessage(channexBookingId: string, message: string): Promise<void> {
    await this.http.request({
      method: 'POST',
      path: `/bookings/${channexBookingId}/messages`,
      body: { message: { message } },
      retries: 0, // not idempotent — never replay a guest message
    });
  }

  /**
   * List the full message thread (inbound + outbound) of a booking. Used to
   * ingest guest messages for the inbox / AI assistant. Webhook-driven +
   * re-fetched (webhooks are triggers, not the source of truth).
   * Verified: GET /bookings/{id}/messages → { data: [ChannexMessage] }.
   */
  async listMessages(channexBookingId: string): Promise<ChannexMessage[]> {
    const raw = await this.http.request({
      method: 'GET',
      path: `/bookings/${channexBookingId}/messages`,
    });
    return MessageListResponse.parse(raw).data ?? [];
  }

  /**
   * Create a booking via the Channex Booking CRS API.
   * Used by the sandbox simulator to mint OTA-like reservations for E2E
   * testing of the inbound ingestion pipeline. The response carries the new
   * booking id; the actual booking shows up in the revisions feed shortly
   * after (async on Channex's side).
   *
   * https://docs.channex.io/api-v.1-documentation/booking-crs-api
   */
  async create(input: BookingCreate): Promise<{ id: string }> {
    const body = {
      booking: {
        property_id: input.propertyId,
        ota_reservation_code: input.otaReservationCode ?? `SIM-${Date.now()}`,
        ota_name: input.otaName ?? 'Offline',
        arrival_date: input.arrivalDate,
        departure_date: input.departureDate,
        currency: input.currency ?? 'EUR',
        ota_commission: '0.00',
        notes: input.notes,
        customer: {
          name: input.guest.name,
          surname: input.guest.surname,
          mail: input.guest.mail,
          phone: input.guest.phone,
          country: input.guest.country,
        },
        rooms: [
          {
            room_type_id: input.roomTypeId,
            rate_plan_id: input.ratePlanId,
            days: buildDaysMap(input.arrivalDate, input.departureDate, input.nightlyRate),
            guests: [{ name: input.guest.name, surname: input.guest.surname }],
            occupancy: {
              adults: input.adults ?? 2,
              children: input.children ?? 0,
              infants: input.infants ?? 0,
              ages: [],
            },
          },
        ],
        services: [],
        deposits: [],
      },
    };

    const raw = await this.http.request<{ data?: { id?: string } }>({
      method: 'POST',
      path: '/bookings',
      body,
    });
    const id = raw?.data?.id;
    if (!id) {
      throw new Error('Channex POST /bookings returned no booking id');
    }
    return { id };
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
