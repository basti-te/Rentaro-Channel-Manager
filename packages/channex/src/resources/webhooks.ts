import { z } from 'zod';
import type { ChannexHttpClient } from '../client';
import { envelope } from '../schemas/common';
import { Webhook, WebhookCreate } from '../schemas/webhook';

const ListResponse = envelope(z.array(Webhook));
const SingleResponse = envelope(Webhook);

export class WebhooksAPI {
  constructor(private readonly http: ChannexHttpClient) {}

  async list() {
    const raw = await this.http.request({
      method: 'GET',
      path: '/webhooks',
    });
    const parsed = ListResponse.parse(raw);
    return parsed.data ?? [];
  }

  /**
   * Create a webhook. For a single global account-wide one, pass
   *   { callback_url, event_mask: '*', is_global: true, property_id: null }
   */
  async create(input: WebhookCreate) {
    const body = { webhook: WebhookCreate.parse(input) };
    const raw = await this.http.request({
      method: 'POST',
      path: '/webhooks',
      body,
      retries: 0,
    });
    return SingleResponse.parse(raw).data!;
  }

  /** Update a webhook (e.g. widen its `event_mask`). */
  async update(id: string, patch: { event_mask?: string; is_active?: boolean }) {
    const raw = await this.http.request({
      method: 'PUT',
      path: `/webhooks/${id}`,
      body: { webhook: patch },
    });
    return SingleResponse.parse(raw).data!;
  }

  async delete(id: string) {
    await this.http.request({
      method: 'DELETE',
      path: `/webhooks/${id}`,
    });
  }
}
