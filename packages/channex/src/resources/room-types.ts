import { z } from 'zod';
import type { ChannexHttpClient } from '../client';
import { envelope } from '../schemas/common';
import { RoomType, RoomTypeCreate } from '../schemas/room-type';

const ListResponse = envelope(z.array(RoomType));
const SingleResponse = envelope(RoomType);

export class RoomTypesAPI {
  constructor(private readonly http: ChannexHttpClient) {}

  async list(opts?: { propertyId?: string; page?: number; limit?: number }) {
    const raw = await this.http.request({
      method: 'GET',
      path: '/room_types',
      query: {
        'filter[property_id]': opts?.propertyId,
        'pagination[page]': opts?.page,
        'pagination[limit]': opts?.limit,
      },
    });
    const parsed = ListResponse.parse(raw);
    return { data: parsed.data ?? [], meta: parsed.meta };
  }

  async create(input: RoomTypeCreate) {
    const body = { room_type: RoomTypeCreate.parse(input) };
    const raw = await this.http.request({
      method: 'POST',
      path: '/room_types',
      body,
      retries: 0,
    });
    return SingleResponse.parse(raw).data!;
  }
}
