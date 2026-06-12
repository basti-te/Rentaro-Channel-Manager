import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { serve as serveInngest } from 'inngest/hono';
import { appRouter, createContext } from '@cm/api';
import { env } from './env';
import { inngest, inngestFunctions } from './inngest';
import { channexWebhook } from './webhooks/channex';
import { twilioWebhook } from './webhooks/twilio';
import { stripeWebhook } from './webhooks/stripe';
import { invoicesRoute } from './invoices/route';

const app = new Hono();

app.use('*', logger());
app.use(
  '*',
  cors({
    origin: env.APP_URL,
    credentials: true,
    allowHeaders: ['authorization', 'content-type'],
  }),
);

app.get('/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }));

// ── Inngest serve endpoint ───────────────────────────────────────────────────
// The inngest-cli dev server (npx inngest-cli@latest dev) auto-discovers
// this URL and runs the function dashboard at http://localhost:8288.
app.on(['GET', 'POST', 'PUT'], '/api/inngest', serveInngest({
  client: inngest,
  functions: inngestFunctions,
}));

// ── tRPC adapter ─────────────────────────────────────────────────────────────
app.all('/trpc/*', async (c) => {
  return fetchRequestHandler({
    endpoint: '/trpc',
    req: c.req.raw,
    router: appRouter,
    createContext: async ({ req }) => {
      const auth = req.headers.get('authorization');
      const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
      return createContext({ bearer, env });
    },
    onError: ({ error, path }) => {
      if (env.NODE_ENV === 'development') {
        console.error(`[tRPC] ${path}:`, error.message);
      }
    },
  });
});

// ── Channex inbound webhooks ─────────────────────────────────────────────────
app.route('/api/webhooks/channex', channexWebhook);
app.route('/api/webhooks/twilio', twilioWebhook);
app.route('/api/webhooks/stripe', stripeWebhook);

// ── Guest-invoice PDF download (public, token-gated) ─────────────────────────
app.route('/api/invoices', invoicesRoute);

const port = env.PORT;
console.log(`→ API server on http://localhost:${port}`);
serve({ fetch: app.fetch, port });
