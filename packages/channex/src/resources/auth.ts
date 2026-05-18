import { z } from 'zod';
import type { ChannexHttpClient } from '../client';

/**
 * Channex one-time-token (OTT) auth — used to embed Channex iframe screens
 * (mapping, messages) into our PMS without ever exposing the API key in the
 * browser.
 *
 * Flow:
 *   1. Server calls createOneTimeToken({ propertyId }) with the API key.
 *   2. The returned token (15-min TTL, single use) is put in the iframe URL:
 *        {appOrigin}/auth/exchange?oauth_session_key={token}
 *          &app_mode=headless&redirect_to=/messages&property_id={propertyId}
 *   3. The browser loads the iframe; Channex exchanges the OTT for a JWT.
 *
 * https://docs.channex.io/api-v.1-documentation/channel-iframe
 */
const OneTimeTokenResponse = z.object({
  data: z.object({ token: z.string() }),
  meta: z.unknown().optional(),
});

export interface OneTimeTokenInput {
  /** Channex property UUID to scope the session to. */
  propertyId: string;
  /** Optional Channex group UUID for an account/group-wide session. */
  groupId?: string;
  /** Identifies the acting user inside Channex (e.g. the host's email). */
  username: string;
}

export class AuthAPI {
  constructor(private readonly http: ChannexHttpClient) {}

  /**
   * Mint a one-time token. MUST be called server-side only — it uses the
   * Channex API key. The token itself is browser-safe (short-lived, single
   * use, scoped to the given property).
   */
  async createOneTimeToken(input: OneTimeTokenInput): Promise<string> {
    const raw = await this.http.request({
      method: 'POST',
      path: '/auth/one_time_token',
      body: {
        one_time_token: {
          property_id: input.propertyId,
          ...(input.groupId ? { group_id: input.groupId } : {}),
          username: input.username,
        },
      },
      retries: 0, // single-use credential — never replay
    });
    return OneTimeTokenResponse.parse(raw).data.token;
  }
}
