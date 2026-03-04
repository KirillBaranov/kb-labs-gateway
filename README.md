# KB Labs Gateway

Central router and single entry point for all KB Labs platform clients (CLI, Studio, Host Agent, IDE extensions).

## Architecture

```
CLI / Studio / IDE
        │
        ▼
  Gateway :4000           ← single endpoint for all clients
   ├── /auth/register  (public — JWT registration)
   ├── /auth/token     (public — issue JWT pair)
   ├── /auth/refresh   (public — rotate JWT pair)
   ├── /health         (public)
   ├── /hosts/register (public — legacy static token)
   ├── /hosts/connect  (WebSocket — Host Agent, JWT Bearer)
   ├── /api/ui/*   → REST API     :5050
   └── /api/exec/* → Workflow     :7778
```

**Host** = any machine connecting to the platform and providing capabilities (filesystem, git, editor-context). The laptop running CLI/Studio is a Host; the cloud server is not.

Two supported deployment scenarios:

| Scenario | Gateway location | Host Agent location |
|----------|-----------------|---------------------|
| Local (default) | `localhost:4000` | same machine |
| Split (cloud) | cloud server | developer laptop |

## Packages

| Package | Description |
|---------|-------------|
| [`@kb-labs/gateway-app`](./apps/gateway-app/) | Fastify server — entry point |
| [`@kb-labs/gateway-contracts`](./packages/gateway-contracts/) | Zod schemas — source of truth |
| [`@kb-labs/gateway-core`](./packages/gateway-core/) | Shared logic (AdaptiveBuffer, TraceContext) |
| [`@kb-labs/gateway-auth`](./packages/gateway-auth/) | JWT auth — register, issue, refresh, verify |

## Quick Start

```bash
# From monorepo root
pnpm dev:start:gateway      # starts gateway + dependencies
# or
pnpm gateway:dev            # dev mode with hot-reload

# Check health
curl http://localhost:4000/health
# → { "status": "ok", "version": "1.0" }
```

## Configuration

Upstreams are declared in `.kb/kb.config.json` — no code changes needed to add a new service:

```json
{
  "gateway": {
    "port": 4000,
    "upstreams": {
      "ui":   { "url": "http://localhost:5050", "prefix": "/api/ui",   "description": "REST API" },
      "exec": { "url": "http://localhost:7778", "prefix": "/api/exec", "description": "Workflow Daemon" }
    }
  }
}
```

To add a new upstream: add an entry to `upstreams` and restart Gateway. The proxy handler is registered automatically.

## Host Agent Protocol

### 1. Register a Host

```bash
curl -X POST http://localhost:4000/hosts/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "laptop",
    "namespaceId": "ns1",
    "capabilities": ["filesystem", "git"],
    "workspacePaths": ["/home/user/projects"]
  }'
# → { "hostId": "...", "machineToken": "...", "status": "offline" }
```

### 2. Connect via WebSocket

```
WS ws://localhost:4000/hosts/connect
Authorization: Bearer <machineToken>
```

#### Handshake sequence

```
Client → Server  { "type": "hello", "protocolVersion": "1.0", "agentVersion": "0.1.0" }
Server → Client  { "type": "connected", "protocolVersion": "1.0", "hostId": "...", "sessionId": "..." }
```

If `protocolVersion` is not supported:
```
Server → Client  { "type": "negotiate", "supportedVersions": ["1.0"] }
                 (connection closed with 1008)
```

#### Heartbeat

Client must send every 30s:
```
Client → Server  { "type": "heartbeat" }
Server → Client  { "type": "ack" }
```

No heartbeat within 40s → host status set to `degraded`.

#### Call / Response (streaming)

```
Server → Client  { "type": "call", "requestId": "...", "adapter": "fs", "method": "readFile", "args": [...], "trace": {...} }
Client → Server  { "type": "chunk",  "requestId": "...", "data": ..., "index": 0 }
Client → Server  { "type": "result", "requestId": "...", "done": true }
```

Non-streaming calls: single `chunk` with `done` omitted, then `result` with `done: true`.

#### Error

```
Client → Server  { "type": "error", "requestId": "...", "error": { "code": "FS_NOT_FOUND", "message": "...", "retryable": false } }
```

### 3. Offline Buffering

While a Host is offline, incoming calls are buffered in ICache with adaptive TTL (30s–5min based on platform load). On reconnect, buffered calls are flushed automatically.

## ICache Key Namespace

```
# Host registry
host:registry:{namespaceId}:{hostId}  → HostDescriptor
host:token:{machineToken}             → { hostId, namespaceId }  (legacy static token)
host:connections:{hostId}             → ConnectionDescriptor[]   (TTL 90s)
host:buffer:{hostId}                  → BufferedCall[]           (adaptive TTL 30s–5min)

# Auth (JWT)
auth:client:{clientId}                → ClientRecord             (permanent)
auth:refresh:{sha256(token)}          → { hostId, namespaceId }  (TTL 30d)
auth:publickey:{hostId}               → X25519 public key        (permanent)
```

## Auth

### JWT flow (M1 — current)

```bash
# 1. Register agent — get clientId + clientSecret (one-time)
curl -X POST http://localhost:4000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"my-laptop","namespaceId":"default","capabilities":["filesystem","git"]}'
# → { "clientId": "clt_...", "clientSecret": "cs_...", "hostId": "host_..." }

# 2. Get token pair
curl -X POST http://localhost:4000/auth/token \
  -H "Content-Type: application/json" \
  -d '{"clientId":"clt_...","clientSecret":"cs_..."}'
# → { "accessToken": "eyJ...", "refreshToken": "eyJ...", "expiresIn": 900, "tokenType": "Bearer" }

# 3. Use access token
curl -H "Authorization: Bearer eyJ..." http://localhost:4000/health

# 4. Rotate tokens (before accessToken expires)
curl -X POST http://localhost:4000/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"eyJ..."}'
# → new token pair; old refreshToken invalidated
```

Token lifetimes: **accessToken = 15 min**, **refreshToken = 30 days** (rotation on use).

### Token types

| Type | Source | Usage |
|------|--------|-------|
| `machine` | `/auth/register` + `/auth/token` | Host Agent WebSocket + API calls |
| static (dev) | `dev-studio-token` env | Studio in local-only mode (fallback) |

Public routes (no auth): `GET /health`, `POST /auth/register`, `POST /auth/token`, `POST /auth/refresh`.

### ICache key namespace (auth)

```
auth:client:{clientId}      → ClientRecord  (permanent)
auth:refresh:{sha256(token)} → { hostId, namespaceId }  (TTL 30d)
auth:publickey:{hostId}     → X25519 public key (base64url)
```

## Development

```bash
# Build
cd kb-labs-gateway && pnpm build

# Dev (watch mode)
pnpm dev

# Type check
pnpm type-check
```

## Extending

### Add a new upstream

Edit `.kb/kb.config.json`:
```json
"upstreams": {
  "mind": {
    "url": "http://localhost:9000",
    "prefix": "/api/mind",
    "description": "Mind RAG (future)"
  }
}
```

Restart Gateway → upstream registered automatically. Zero code changes.

### Add a new Host capability

1. Add value to `HostCapabilitySchema` enum in `packages/gateway-contracts/src/host.ts`
2. Host Agent declares capability in `/hosts/register`
3. Gateway routes calls to the right adapter based on capability

### Future

- Rate limiting per namespace/tier (core-tenant)
- Multi-instance with sticky sessions
- Bulk upload endpoint (BulkRedirect message type already in protocol)
- Host Agent client library (separate package)
- Go rewrite for the proxy layer if throughput requires it (architecture unchanged — same protocol)
