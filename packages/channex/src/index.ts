/**
 * @cm/channex — Typed client for the Channex.io REST API (Whitelabel).
 *
 * Phase 4 will fill this in. For Phase 0 we only export the config shape so
 * other packages can already type-check against it.
 */

export interface ChannexConfig {
  /** Sandbox: https://staging.channex.io/api/v1 — Prod: https://channex.io/api/v1 */
  baseUrl: string;
  /** Sent in the `user-api-key` header. */
  apiKey: string;
}

export function createChannexClient(config: ChannexConfig) {
  // Stub. Implemented in Phase 4.
  return {
    config,
    async ping() {
      throw new Error('Channex client not implemented yet (Phase 4)');
    },
  };
}
