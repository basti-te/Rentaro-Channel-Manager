# Migrations

Drizzle generates table migrations into this folder when you run:

```bash
pnpm db:generate
```

The numbered files are auto-managed. **Hand-written SQL for RLS, triggers,
and other non-introspectable Postgres objects lives in `../post-migrate/`**
and is applied right after `drizzle-kit migrate` by the `apply-post-migrate.ts`
script. Don't touch the auto-generated migration files; they're committed for
reproducibility.

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
