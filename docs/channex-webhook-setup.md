# Channex inbound webhook setup

Register the global webhook ONCE per Channex account so Channex pushes
booking events to our worker.

## URL shape

```
POST  <PUBLIC_WORKER_URL>/api/webhooks/channex/<CHANNEX_WEBHOOK_SECRET>
```

- `PUBLIC_WORKER_URL` — where the worker is reachable from the internet.
  In production that's Vercel / Railway / Fly. In dev you need ngrok or
  similar.
- `CHANNEX_WEBHOOK_SECRET` — from `.env.local`. Used as a path-segment
  shared secret because Channex doesn't HMAC-sign its outbound calls.
  Rotate by regenerating + updating both Channex and our env.

## One-time registration via the Channex API

Once you have a public URL, register the webhook by POSTing:

```bash
curl -X POST 'https://staging.channex.io/api/v1/webhooks' \
  -H 'user-api-key: <CHANNEX_API_KEY>' \
  -H 'content-type: application/json' \
  -d '{
    "webhook": {
      "callback_url": "https://your-worker.example.com/api/webhooks/channex/<SECRET>",
      "event_mask": "booking_new,booking_modification,booking_cancellation,non_acked_booking",
      "property_id": null,
      "is_global": true,
      "is_active": true,
      "send_data": true
    }
  }'
```

`event_mask: "*"` works too — subscribes to everything. We only act on
booking events; ARI / message / review events arrive but are stored as
audit rows in `webhook_deliveries`.

Channex performs a verification ping (single POST with a marker body) on
registration. Our handler returns `200` for anything that passes the
secret check, so verification succeeds automatically.

## Local development

Channex can deliver to any public URL. Choices for getting one from
localhost:

- **ngrok**: `ngrok http 3001` → use the printed `*.ngrok-free.app`
  URL for the `callback_url`.
- **cloudflared**: `cloudflared tunnel --url http://localhost:3001`
- **Skip and simulate**: replay realistic webhook bodies with curl
  against `http://localhost:3001/api/webhooks/channex/<SECRET>`. The
  ingest function runs end-to-end including the Channex feed pull.

## Useful inspection

```bash
pnpm --filter @cm/db webhooks:latest    # 3 most recent webhook_deliveries
```

Inngest dev UI at `http://localhost:8288` shows each ingest run with
step-level traces.
