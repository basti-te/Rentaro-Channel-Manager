import type { ChannexHttpClient } from '../client';
import { RestrictionUpdate } from '../schemas/restriction';
import { parseTaskIds } from '../schemas/common';

/**
 * Bulk-update rates and restrictions. Same batching philosophy as
 * AvailabilityAPI.push.
 *
 * https://docs.channex.io/api-v.1-documentation/ari
 */
export class RestrictionsAPI {
  constructor(private readonly http: ChannexHttpClient) {}

  /**
   * Push rate / restriction changes.
   *
   * @example Set a rate of 80 EUR (8000 cents) and a 2-night minimum for May:
   *   await client.restrictions.push([
   *     { property_id, rate_plan_id, date_from: '2026-05-01', date_to: '2026-05-31',
   *       rate: 8000, min_stay: 2 },
   *   ]);
   */
  async push(updates: RestrictionUpdate[]): Promise<string[]> {
    if (updates.length === 0) return [];
    const validated = updates.map((u) => RestrictionUpdate.parse(u));
    const res = await this.http.request({
      method: 'POST',
      path: '/restrictions',
      body: { values: validated },
      retries: 3,
    });
    return parseTaskIds(res);
  }
}
