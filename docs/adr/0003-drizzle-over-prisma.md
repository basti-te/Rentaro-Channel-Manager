# ADR 0003 — Drizzle over Prisma

**Status:** Accepted
**Date:** 2026-05-14

## Decision

Use Drizzle ORM.

## Reasons

- **No Rust binary.** Prisma's query engine is a Rust binary that adds
  cold-start latency in serverless and is fiddly to deploy. Drizzle is pure
  TypeScript.
- **SQL-first.** Drizzle queries read like SQL. We expect to write complex
  queries for the calendar (date-range overlaps, bookings per property per
  date span). Prisma's nested object syntax abstracts away the SQL we need
  to understand.
- **Better RLS story.** Drizzle exposes the raw connection cleanly, so
  setting `SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims = '…';`
  for RLS works naturally. Prisma's connection pooling fights with per-query
  RLS context.
- **Migrations as SQL files.** `drizzle-kit` generates SQL, which we commit.
  We can hand-edit (we do, for RLS policies). Prisma's migrate is more opaque.
- **Type inference is strict.** `typeof table.$inferSelect` is exactly the
  row shape. No `select` projections to worry about.

## Trade-offs

**−** Smaller ecosystem than Prisma. No first-party studio (but `drizzle-kit
studio` exists), fewer tutorials.

**−** Less ergonomic for relations — `db.query.bookings.findMany({ with: {
property: true } })` works but isn't as polished as Prisma's.

## Decision triggers for revisiting

Revisit if: Drizzle becomes unmaintained, Prisma drops the Rust binary AND
gets clean RLS support, our query patterns shift to mostly nested object
shapes.
