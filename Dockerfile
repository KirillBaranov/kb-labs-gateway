FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 gateway

# Pre-built artifacts from GitHub Actions runner
COPY --chown=gateway:nodejs apps/     ./apps/
COPY --chown=gateway:nodejs packages/ ./packages/
COPY --chown=gateway:nodejs node_modules/ ./node_modules/
COPY kb.config.production.json ./kb.config.json

USER gateway

EXPOSE 4000

CMD ["node", "apps/gateway-app/dist/index.js"]
