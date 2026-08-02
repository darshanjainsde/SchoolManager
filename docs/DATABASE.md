# The database is the repo

Every table, index, enum and RLS policy this product needs lives in
`packages/db/prisma/migrations/`. There is no step where someone hand-writes
SQL into a dashboard and hopes the next environment matches.

That means **standing up a brand-new database is a button, not a project** —
which is the whole point, because the alternative is what already happened:
staging drifted four migrations behind main and nobody noticed until an
unrelated build broke.

---

## Stand up a completely new database

1. Create an empty Postgres (Supabase: new project — pick the region carefully,
   it cannot be changed later).
2. Put its two connection strings in the matching **GitHub Environment**
   (below).
3. Run the **db-migrate** workflow against that environment with
   **seed: true**.

That's it. All migrations apply in order, including
`20260703_000100_rls_and_roles`, so the new database gets the `skoolos_app` /
`skoolos_platform` roles and behaves like production rather than running
everything as `postgres`.

## Update an existing database

Run **db-migrate** against it. `prisma migrate deploy` applies only what's
missing and is a no-op when there's nothing to do, so re-running is always
safe. Staging does this automatically whenever a migration lands on the
`staging` branch.

## Know when something has drifted

**db-drift** runs every morning, read-only, against both environments and fails
loudly if either has migrations pending.

---

## One-time setup: GitHub Environments

Settings → Environments → New environment. Create **`staging`** and
**`production`**, and give each two secrets:

| Secret | Where it comes from |
|---|---|
| `DATABASE_URL` | Supabase → Project Settings → Database → Connection string → **Transaction pooler** (port 6543), plus `?pgbouncer=true` |
| `DIRECT_URL` | Same page → **Session pooler** (port 5432). Prisma needs a non-pooled connection to run migrations. |

Two things that have already cost time on this project:

- **Percent-encode the password.** An `@` must be written `%40`, or the host
  gets truncated and you get a DNS error that looks nothing like the real
  cause.
- **Copy the pooler host from the dashboard.** Supabase assigns the pooler
  number per project — production is `aws-1`, the old Tokyo staging was
  `aws-0`. Don't infer it from the region.

On the **production** environment also switch on **Required reviewers** (add
yourself). A production migration then waits for an explicit approval click
instead of running the moment someone triggers it.

### Why secrets live here and not in a `.env` you paste around

A connection string in a chat window, a screenshot or a clipboard is a
credential you now have to rotate. In a GitHub Environment it is write-only:
the workflow can use it, nobody can read it back, and rotating it is one field.

---

## Local development

```bash
docker compose up -d          # local postgres
pnpm db:migrate:dev           # apply + create migrations
pnpm --filter @skoolos/db seed
```

`seed.ts` begins with `loadEnv()`, which reads the root `.env` and **overrides
already-exported variables**. So `DATABASE_URL=... pnpm seed` does *not* seed
the database you named — it seeds whatever the root `.env` points at, while
printing success for every row. To seed a remote database, write the URL into
`.env` first (which is exactly what the workflow's seed step does).

---

## Changing the schema

```bash
# 1. edit packages/db/prisma/schema.prisma
pnpm db:migrate:dev --name what_you_changed   # writes the migration + applies locally
pnpm preflight                                 # the full gate before pushing
```

Commit the generated migration folder. From then on it is applied to every
environment by the workflows above, in the same order, forever.

**Never edit a migration that has already been applied anywhere.** Its checksum
is recorded in `_prisma_migrations`, and changing it makes Prisma refuse to
touch that database. Write a new migration instead.
