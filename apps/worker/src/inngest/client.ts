import { EventSchemas, Inngest } from 'inngest';
import { env } from '../env';
import type { Events } from './events';

/**
 * The single Inngest client for the worker. This is the SERVER side — it
 * exposes functions via the /api/inngest serve adapter. The API package
 * (packages/api) gets its own thin emitter that points at the same events.
 *
 * In dev (no event/signing key) Inngest auto-detects and talks to the local
 * inngest-cli dev server. For production set INNGEST_EVENT_KEY and
 * INNGEST_SIGNING_KEY from your inngest.com app.
 */
export const inngest = new Inngest({
  id: env.INNGEST_APP_ID ?? 'channel-manager',
  eventKey: env.INNGEST_EVENT_KEY || undefined,
  ...(env.INNGEST_BASE_URL ? { baseUrl: env.INNGEST_BASE_URL } : {}),
  schemas: new EventSchemas().fromRecord<Events>(),
});
