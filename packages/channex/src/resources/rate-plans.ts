import { z } from 'zod';
import type { ChannexHttpClient } from '../client';
import { envelope } from '../schemas/common';
import { RatePlan, RatePlanCreate } from '../schemas/rate-plan';

const ListResponse = envelope(z.array(RatePlan));
const SingleResponse = envelope(RatePlan);

export class RatePlansAPI {
  constructor(private readonly http: ChannexHttpClient) {}

  async list(opts?: {
    propertyId?: string;
    roomTypeId?: string;
    page?: number;
    limit?: number;
  }) {
    const raw = await this.http.request({
      method: 'GET',
      path: '/rate_plans',
      query: {
        'filter[property_id]': opts?.propertyId,
        'filter[room_type_id]': opts?.roomTypeId,
        'pagination[page]': opts?.page,
        'pagination[limit]': opts?.limit,
      },
    });
    const parsed = ListResponse.parse(raw);
    return { data: parsed.data ?? [], meta: parsed.meta };
  }

  async create(input: RatePlanCreate) {
    const body = { rate_plan: RatePlanCreate.parse(input) };
    const raw = await this.http.request({
      method: 'POST',
      path: '/rate_plans',
      body,
      retries: 0,
    });
    return SingleResponse.parse(raw).data!;
  }
}
