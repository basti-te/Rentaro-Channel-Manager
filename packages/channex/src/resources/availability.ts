import type { ChannexHttpClient } from '../client';
import { AvailabilityUpdate } from '../schemas/availability';
import { parseTaskIds } from '../schemas/common';

/**
 * Bulk-update availability. Per Channex best practices: combine all changes
 * for a request into ONE call rather than many small ones (one message with
 * 100 day changes beats 100 single-day messages).
 *
 * https://docs.channex.io/api-v.1-documentation/ari
 */
export class AvailabilityAPI {
  constructor(private readonly http: ChannexHttpClient) {}

  /**
   * Push availability changes. Returns the Channex task id(s) generated for
   * the async processing of this write (used by the full-sync / certification
   * flow; empty array if Channex returns no task envelope).
   *
   * @example
   *   const taskIds = await client.availability.push([
   *     { property_id, room_type_id, date_from: '2026-05-14', date_to: '2026-05-17', availability: 0 },
   *   ]);
   */
  async push(updates: AvailabilityUpdate[]): Promise<string[]> {
    if (updates.length === 0) return [];
    const validated = updates.map((u) => AvailabilityUpdate.parse(u));
    // Channex accepts up to 10 MB payloads; we don't chunk here, callers must
    // batch sensibly if they're pushing thousands of dates at once.
    const res = await this.http.request({
      method: 'POST',
      path: '/availability',
      body: { values: validated },
      // Idempotent in effect: re-applying the same availability is safe.
      retries: 3,
    });
    return parseTaskIds(res);
  }
}
