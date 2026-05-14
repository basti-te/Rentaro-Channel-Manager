# ADR 0005 — Vite SPA over Next.js

**Status:** Accepted
**Date:** 2026-05-14

## Decision

Use React + Vite (SPA), with TanStack Router for routing. tRPC over HTTPS to
Vercel Functions for the API.

## Reasons

- **No SSR need.** This is an authenticated dashboard. There's no SEO use
  case. No content for crawlers. SSR adds complexity without benefit.
- **Vite dev experience.** HMR is faster than Next.js, Vite config is
  simpler, and we don't need the Next.js layout/route conventions.
- **TanStack Router > Next.js App Router for our use case.** Type-safe
  search-params (we have a lot of these for the calendar), built-in
  loaders with caching, simpler mental model.
- **Calendar UI is heavy and stateful.** It belongs in the browser, not as
  server components. Next.js's App Router pushes us toward RSC patterns we
  don't want here.
- **Static deploy is trivial.** Vercel hosts the SPA as static files, API
  routes for tRPC as serverless functions.

## Trade-offs

**−** No SSR means slower first-page paint for cold users (but they're
authenticated; loading state is fine).

**−** Public marketing pages would need a separate setup. Likely use Astro
or Next.js for those, kept in a different repo.

## Revisit if

- We add a public-facing booking widget that needs SEO
- The dashboard needs to support no-JavaScript users (unlikely)
