import { z } from 'zod';
import type { ChannexHttpClient } from '../client';
import { envelope } from '../schemas/common';
import { Property, PropertyCreate } from '../schemas/property';

const ListResponse = envelope(z.array(Property));
const SingleResponse = envelope(Property);

export class PropertiesAPI {
  constructor(private readonly http: ChannexHttpClient) {}

  async list(opts?: { page?: number; limit?: number }) {
    const raw = await this.http.request({
      method: 'GET',
      path: '/properties',
      query: { 'pagination[page]': opts?.page, 'pagination[limit]': opts?.limit },
    });
    const parsed = ListResponse.parse(raw);
    return {
      data: parsed.data ?? [],
      meta: parsed.meta,
    };
  }

  async get(id: string) {
    const raw = await this.http.request({
      method: 'GET',
      path: `/properties/${id}`,
    });
    return SingleResponse.parse(raw).data!;
  }

  async create(input: PropertyCreate) {
    const body = { property: PropertyCreate.parse(input) };
    const raw = await this.http.request({
      method: 'POST',
      path: '/properties',
      body,
      retries: 0, // not idempotent — never retry create
    });
    return SingleResponse.parse(raw).data!;
  }
}
