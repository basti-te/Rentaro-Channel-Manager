# Migrations

Drizzle generates table migrations into this folder when you run:

```bash
pnpm db:generate
```

The numbered files are auto-managed. **`9999_rls_policies.sql`** is hand-written
and applies Row-Level Security after the tables exist. Don't touch the
auto-generated ones; they're committed for reproducibility.

## Apply to a database

```bash
pnpm db:migrate
```

This runs all pending migrations in order against `DATABASE_URL_DIRECT`. The
RLS file is picked up because it lives in this folder and starts with `9999_`
(after all numerical migrations).

## Drizzle Studio

```bash
pnpm db:studio
```

Opens a local web UI to inspect data. Useful when debugging.
