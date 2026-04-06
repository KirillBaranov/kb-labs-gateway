FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy everything
COPY . .

# Replace link: and workspace:* with published npm versions
RUN sed -i \
  -e 's|"link:[^"]*"|"*"|g' \
  -e 's|"workspace:\*"|"*"|g' \
  apps/gateway-app/package.json \
  packages/gateway-auth/package.json \
  packages/gateway-contracts/package.json \
  packages/gateway-core/package.json

RUN echo "shamefully-hoist=true" >> .npmrc && \
    corepack enable pnpm && pnpm install --frozen-lockfile=false && \
    pnpm --filter @kb-labs/gateway-app... run build

# ── runner ────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 gateway

COPY --from=builder /app/node_modules                       ./node_modules
COPY --from=builder /app/apps/gateway-app/dist              ./apps/gateway-app/dist
COPY --from=builder /app/packages/gateway-auth/dist         ./packages/gateway-auth/dist
COPY --from=builder /app/packages/gateway-contracts/dist    ./packages/gateway-contracts/dist
COPY --from=builder /app/packages/gateway-core/dist         ./packages/gateway-core/dist

COPY kb.config.production.json ./kb.config.json

USER gateway

EXPOSE 4000

CMD ["node", "apps/gateway-app/dist/index.js"]
