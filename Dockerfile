FROM node:20-alpine AS base

# ── deps ─────────────────────────────────────────────────────────────────────
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json pnpm-workspace.yaml ./
COPY apps/gateway-app/package.json       ./apps/gateway-app/
COPY packages/gateway-auth/package.json  ./packages/gateway-auth/
COPY packages/gateway-contracts/package.json ./packages/gateway-contracts/
COPY packages/gateway-core/package.json  ./packages/gateway-core/

# Replace link: and workspace:* with published npm versions
RUN sed -i \
  -e 's|"link:[^"]*"|"*"|g' \
  -e 's|"workspace:\*"|"*"|g' \
  apps/gateway-app/package.json \
  packages/gateway-auth/package.json \
  packages/gateway-contracts/package.json \
  packages/gateway-core/package.json

RUN corepack enable pnpm && pnpm install --frozen-lockfile=false

# ── builder ───────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules

COPY . .

RUN corepack enable pnpm && pnpm --filter @kb-labs/gateway-app... run build

# ── runner ────────────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 gateway

COPY --from=builder /app/node_modules                       ./node_modules
COPY --from=builder /app/apps/gateway-app/dist              ./apps/gateway-app/dist
COPY --from=builder /app/packages/gateway-auth/dist         ./packages/gateway-auth/dist
COPY --from=builder /app/packages/gateway-contracts/dist    ./packages/gateway-contracts/dist
COPY --from=builder /app/packages/gateway-core/dist         ./packages/gateway-core/dist

# Minimal production config — gateway section only, no products/plugins
COPY kb.config.production.json ./kb.config.json

USER gateway

EXPOSE 4000

CMD ["node", "apps/gateway-app/dist/index.js"]
