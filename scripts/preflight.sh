#!/usr/bin/env bash
#
# preflight — run the SAME gates the deploy platforms run, locally, before you push.
#
# Why this exists: `pnpm test` + `typecheck` + `lint` is a WEAKER gate than what
# Vercel and EAS actually run. Two production build failures came from exactly
# that gap:
#   • Vercel runs `next build`, which validates App Router file exports — a
#     stray `export const NAV_ITEMS` from a layout compiles/lints/unit-tests
#     clean but fails `next build`. (Guard: app/route-file-exports.test.ts)
#   • EAS runs gradle + Expo autolinking, which needs a hoisted node_modules in
#     this pnpm monorepo. (Guard: apps/mobile eas-build-config.test.ts)
#
# This script runs the full CI gate — crucially INCLUDING `pnpm build`
# (= `next build` + api bundle) — so those failures surface here, not in the
# cloud. Run it before every push/merge:  pnpm preflight
#
set -uo pipefail
cd "$(dirname "$0")/.."

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

step "lint"                 pnpm lint
step "typecheck"            pnpm typecheck
step "module boundary"      pnpm boundary
step "build (next build + api bundle — the Vercel gate)" pnpm build
step "unit + guard tests"   pnpm test

# Mobile is built by EAS, not turbo — so `pnpm build` never touches it. The
# eas-build-config guard test (run above under `pnpm test`) pins the hoisted
# node-linker autolinking fix, and the mobile jest suite runs too. A real EAS
# build remains the final word for mobile-native regressions; run one before a
# store release:  cd apps/mobile && eas build -p android --profile production
echo ""
echo "ℹ mobile: covered by its jest suite + the eas-build-config guard above."
echo "  A full EAS build is still the final gate for native/autolinking changes."

echo ""
if [ "$fail" -eq 0 ]; then
  echo "✅ preflight passed — the cloud gates that bit us before are green. Safe to push."
else
  echo "❌ preflight FAILED — fix the ✗ steps above before pushing (they WILL fail the deploy)."
  exit 1
fi
