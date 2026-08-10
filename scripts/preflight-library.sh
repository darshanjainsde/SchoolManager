#!/usr/bin/env bash
#
# preflight-library — the same-shape gate as scripts/preflight.sh, scoped to
# the library microservice (apps/library-api + packages/library-db) so it
# can be run fast and independently of the Sckools app.
#
# Two things this script exists to get right, both because they already cost
# this project time once:
#
#   1. `pnpm --filter <pkg> exec ...` (and `pnpm --filter <pkg> run ...`) sets
#      cwd to the package directory, and the Prisma CLI does NOT walk up
#      looking for a root .env from there. So this script sources the root
#      .env itself, at the top, with `set -a` — every step below inherits
#      real env vars as exported shell state, not as something a package's
#      own dotenv call has to rediscover.
#
#   2. `packages/library-db/package.json`'s `build` script is
#      `tsc -p tsconfig.json || true` — it deliberately never fails, so a
#      real type error there would pass a gate that only checked `build`.
#      `typecheck` (no `|| true`) runs as its own step BEFORE build for
#      exactly that reason: it is what actually fails this script on a type
#      error, `build` failing is not load-bearing here.
#
# If `prisma generate`/`migrate status` below ever reports the
# `20260809190637_init_identity` migration as pending on a database that
# actually already has its tables (i.e. it was applied under its old,
# pre-rename name), run
# `pnpm --filter @library/db run reconcile:init-identity-rename` once first
# — see packages/library-db/prisma/reconcile-init-identity-rename.sql for why.
#
set -uo pipefail
cd "$(dirname "$0")/.."

# --- 1: load env (see rationale above) ---
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

fail=0
step() {
  local name="$1"; shift
  echo ""
  echo "▶ $name"
  if "$@"; then
    echo "  ✓ $name"
  else
    echo "  ✗ $name FAILED"
    fail=1
  fi
}

# Both library packages are the workspace filter target throughout — this
# keeps the gate fast (no Sckools build/test) and independent of any
# Sckools-only env vars.
LIB_FILTER=(--filter "@library/*")

step "prisma generate (library-db)" pnpm --filter @library/db run generate
step "lint"                         pnpm "${LIB_FILTER[@]}" run lint
step "typecheck"                    pnpm "${LIB_FILTER[@]}" run typecheck
step "module boundary"              pnpm exec depcruise apps/library-api/src packages/library-db/src \
                                       --config .dependency-cruiser.library.cjs
step "build"                        pnpm "${LIB_FILTER[@]}" run build
step "unit tests"                   pnpm "${LIB_FILTER[@]}" run test

# e2e talks to a real Postgres (RLS/advisory-lock/unique-constraint races
# that no mock can exercise — see test/*.e2e.spec.ts). It self-skips
# (describeLive → describe.skip, see test/helpers/live-db.ts's LIVE flag)
# whenever LIBRARY_DATABASE_URL_PLATFORM isn't a real postgres URL, so it is
# silently absent from a checkout with no local stack rather than failing —
# but here, gate it explicitly so a misconfigured/missing stack is reported
# as "e2e skipped", never silently green from an empty test run.
if [ -n "${LIBRARY_DATABASE_URL_PLATFORM:-}" ]; then
  step "e2e tests (real Postgres — docker-compose.library.yml)" \
    pnpm --filter @library/api run test:e2e
else
  echo ""
  echo "ℹ e2e skipped — LIBRARY_DATABASE_URL_PLATFORM is not set. Bring up"
  echo "  docker-compose.library.yml and source .env to include it."
fi

echo ""
if [ "$fail" -eq 0 ]; then
  echo "✅ preflight:library passed — safe to push apps/library-api / packages/library-db changes."
else
  echo "❌ preflight:library FAILED — fix the ✗ steps above before pushing."
  exit 1
fi
