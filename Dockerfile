FROM node:20-alpine

WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 gateway

RUN npm install @kb-labs/gateway-app

COPY kb.config.production.json ./kb.config.json

USER gateway

EXPOSE 4000

CMD ["node", "node_modules/@kb-labs/gateway-app/dist/index.js"]
