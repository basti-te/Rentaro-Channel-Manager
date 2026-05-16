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

  /**
   * Whether the Channex Booking CRS API (POST /bookings) is usable for this
   * property. Channex authorizes CRS bookings only when a CRS application is
   * connected to the property — that surfaces as an extra user in
   * `relationships.users` whose email is under the `@channex.io` app domain
   * (e.g. `apaleoapp@channex.io`). Human users have real email domains.
   *
   * Returns false on any error so callers can treat it as "not capable".
   */
  async crsCapable(id: string): Promise<boolean> {
    try {
      const raw = await this.http.request<{
        data?: {
          relationships?: {
            users?: { data?: Array<{ attributes?: { email?: string | null } }> };
          };
        };
      }>({ method: 'GET', path: `/properties/${id}` });
      const users = raw?.data?.relationships?.users?.data ?? [];
      return users.some((u) =>
        (u?.attributes?.email ?? '').toLowerCase().endsWith('@channex.io'),
      );
    } catch {
      return false;
    }
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
