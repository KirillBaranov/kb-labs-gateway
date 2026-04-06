FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 gateway

# Artifacts prepared by pnpm deploy on the CI runner
COPY --chown=gateway:nodejs . .

USER gateway

EXPOSE 4000

CMD ["node", "apps/gateway-app/dist/index.js"]
