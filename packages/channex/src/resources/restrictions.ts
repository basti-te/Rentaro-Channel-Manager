import type { ChannexHttpClient } from '../client';
import { RestrictionUpdate } from '../schemas/restriction';
import { parseTaskIds } from '../schemas/common';

/** One day's read-back rate + stay restriction for a rate plan. */
export interface DayRate {
  date: string; // YYYY-MM-DD
  /** Nightly rate in MINOR units (cents). Null if Channex returned none. */
  rateCents: number | null;
  /** Minimum stay (nights, arrival-based). Null if Channex returned none. */
  minStay: number | null;
}

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

  /**
   * READ effective rates back from Channex for one property + rate plan over a
   * date range (GET /restrictions). Returns the per-day nightly rate that
   * Channex currently holds — i.e. when a tenant uses PriceLabs, these are the
   * PriceLabs prices (Channex is the hub; PriceLabs writes straight into it).
   *
   * Channex returns rate as a DECIMAL STRING in MAJOR units ("200.00"); we
   * convert to integer cents to match the rest of our money handling.
   * Response shape: { data: { [ratePlanId]: { [date]: { rate: "200.00" } } } }
   *
   * NOTE: Channex limits this to 10 rate/price reads per minute PER PROPERTY —
   * callers must cache + pace. Returns only days Channex actually returned.
   *
   * https://docs.channex.io/api-v.1-documentation/ari (Get Restrictions)
   */
  async readRates(params: {
    propertyId: string;
    ratePlanId: string;
    dateFrom: string; // YYYY-MM-DD
    dateTo: string; // YYYY-MM-DD inclusive
  }): Promise<DayRate[]> {
    const res = await this.http.request<{
      data?: Record<
        string,
        Record<string, { rate?: string | null; min_stay_arrival?: string | number | null }>
      >;
    }>({
      method: 'GET',
      path: '/restrictions',
      query: {
        'filter[property_id]': params.propertyId,
        'filter[date][gte]': params.dateFrom,
        'filter[date][lte]': params.dateTo,
        'filter[restrictions]': 'rate,min_stay_arrival',
      },
    });

    const byDate = res?.data?.[params.ratePlanId] ?? {};
    const out: DayRate[] = [];
    for (const [date, v] of Object.entries(byDate)) {
      const raw = v?.rate;
      const rateNum = raw == null || raw === '' ? null : Number(raw);
      const msRaw = v?.min_stay_arrival;
      const msNum = msRaw == null || msRaw === '' ? null : Number(msRaw);
      out.push({
        date,
        rateCents: rateNum != null && Number.isFinite(rateNum) ? Math.round(rateNum * 100) : null,
        minStay: msNum != null && Number.isFinite(msNum) ? msNum : null,
      });
    }
    return out;
  }
}
