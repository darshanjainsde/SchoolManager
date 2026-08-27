# Load-test & functional-equivalence harness

Built for the Phase 1 query-scoping work (PR #34) and kept as the standard for
every later scale change. See
`docs/superpowers/specs/2026-08-28-scale-hardening-v2-staging.md` §9.

## Why it exists

The unit suite is mock-based: it proves a Prisma `where` clause changed as
intended, but it cannot prove the query still returns the same rows. A scale
change that is "obviously equivalent" is exactly the kind that quietly isn't.

`diff-api.py` closes that gap. It runs two builds of the API against **one**
database with the same token and host, calls every GET route the app reports in
its own route table, and compares responses byte-for-byte.

On PR #34 it compared 141 routes: 140 identical, and the single difference was
`GET /manage/attendance/status` returning HTTP 500 before the fix and 200 after
— a latent production outage the unit tests could not have seen.

## Seeding a production-shaped database

```bash
createdb skoolos_lt2
DATABASE_URL=postgresql://…/skoolos_lt2 DIRECT_URL=$DATABASE_URL \
  pnpm --filter @skoolos/db exec prisma migrate deploy
psql -d skoolos_lt2 -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto;'

# 200 schools, 100k students
psql -d skoolos_lt2 -v nschools=200 -v nstudents=500 -f seed.sql

# 9M attendance rows, 10 days at a time (one big statement blows up WAL)
for s in 0 10 20 30 40 50 60 70 80; do
  psql -d skoolos_lt2 -v dfrom=$s -v dto=$((s+9)) -f seed-attendance.sql
done
psql -d skoolos_lt2 -c 'ANALYZE;'
```

Everything is tagged `slug LIKE 'lt-%'`, so it is trivially removable.

## Running the differential diff

Boot both builds against the same database on different ports, then:

```bash
python3 diff-api.py    # expects :3006 = after, :3007 = before
```

It reads `ids.txt` (tenant/section/student ids), `tok.txt` (a SCHOOL_ADMIN
access token) and `get-routes.txt`, which is produced from a boot log:

```bash
grep -oE 'Mapped \{[^,]+, GET\}' after.log | sed -E 's/Mapped \{(.*), GET\}/\1/' | sort -u > get-routes.txt
```

## Load profile

`k6-attendance.js` ramps virtual users against `GET /manage/attendance`, picking
a random tenant and random date per request so the Postgres buffer cache cannot
mask the cost. Run with `DISABLE_THROTTLER=true` so you measure the database
ceiling rather than the rate limiter.

**Baseline to beat** (200 schools / 9M rows, PR #34): 1,336 req/s at 40 VUs,
p95 47 ms, 0% errors. Pre-fix it was 34.5 req/s, p95 2,076 ms, and 20.8% errors
at 100 VUs.
