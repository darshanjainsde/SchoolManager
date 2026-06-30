# SkoolOS API — production Dockerfile.
#
# The repo's apps/api uses ts-node at runtime (the existing `start` script in
# apps/api/package.json), because tsconfig.json sets `noEmit: true` for the
# tsc-typecheck step. We mirror that here: install + generate Prisma, then
# launch the API via `pnpm --filter @skoolos/api start`. At start we also
# run `prisma migrate deploy` so a fresh DB self-migrates.

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

# ─── deps + build (Prisma client only — no tsc emit needed) ────────────────
FROM base AS build
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/types/package.json packages/types/
COPY packages/config/package.json packages/config/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @skoolos/db exec prisma generate
# Optional: a typecheck here would fail-fast on bad code, at the cost of build time.
# RUN pnpm --filter @skoolos/api typecheck

# ─── runtime ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app
ENV NODE_ENV=production
ENV API_PORT=3001

# Argon2 needs C++ runtime — alpine ships musl, so we need libstdc++.
RUN apk add --no-cache libstdc++

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/packages ./packages
COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-workspace.yaml ./
COPY --from=build /app/pnpm-lock.yaml ./

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -O- http://localhost:${API_PORT}/health || exit 1

# Run migrations then start. If migrate deploy fails the container exits non-zero
# so the orchestrator can decide whether to retry; we don't swallow the error.
CMD sh -c "cd /app/packages/db && pnpm exec prisma migrate deploy && cd /app && pnpm --filter @skoolos/api start"
