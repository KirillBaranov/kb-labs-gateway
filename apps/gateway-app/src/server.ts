import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHttpProxy from '@fastify/http-proxy';
import { platform } from '@kb-labs/core-runtime';
import { registerOpenAPI } from '@kb-labs/shared-http';
import type { ICache, ILogger } from '@kb-labs/core-platform';
import type { GatewayConfig } from '@kb-labs/gateway-contracts';
import { HostRegistrationSchema } from '@kb-labs/gateway-contracts';
import { AuthService, type JwtConfig } from '@kb-labs/gateway-auth';
import { createAuthMiddleware } from './auth/middleware.js';
import { registerAuthRoutes } from './auth/routes.js';
import { registerExecuteRoutes } from './execute/routes.js';
import { registerLLMGatewayRoutes } from './llm/routes.js';
import { registerTelemetryRoutes } from './telemetry/routes.js';
import { registerPlatformRoutes } from './platform/routes.js';
import { registerAggregatedDocsRoutes } from './docs/routes.js';
import { HostRegistry } from './hosts/registry.js';
import { globalDispatcher } from './hosts/dispatcher.js';
import { attachGatewayWs } from './ws/gateway-ws.js';

function asMeta(arg: unknown): Record<string, unknown> | undefined {
  return arg && typeof arg === 'object' && !Array.isArray(arg) ? (arg as Record<string, unknown>) : undefined;
}

function pinoCompatibleLogger(logger: ILogger) {
  return {
    trace: (msg: string, ...args: unknown[]) => logger.debug(msg, asMeta(args[0])),
    debug: (msg: string, ...args: unknown[]) => logger.debug(msg, asMeta(args[0])),
    info: (msg: string, ...args: unknown[]) => logger.info(msg, asMeta(args[0])),
    warn: (msg: string, ...args: unknown[]) => logger.warn(msg, asMeta(args[0])),
    error: (msg: string, ...args: unknown[]) => logger.error(msg, args[0] instanceof Error ? args[0] : undefined),
    fatal: (msg: string, ...args: unknown[]) => logger.error(`[FATAL] ${msg}`, args[0] instanceof Error ? args[0] : undefined),
    child: () => pinoCompatibleLogger(logger),
    level: 'info',
    silent: () => {},
  };
}

export async function createServer(
  config: GatewayConfig,
  cache: ICache,
  logger: ILogger,
  jwtConfig: JwtConfig,
  registry?: HostRegistry,
) {
  const app = Fastify({
    loggerInstance: pinoCompatibleLogger(logger) as unknown as Parameters<typeof Fastify>[0]['loggerInstance'],
  });

  const isProduction = process.env.NODE_ENV === 'production';

  // OpenAPI / Swagger UI — must be registered before routes
  await registerOpenAPI(app, {
    title: 'KB Labs Gateway',
    description: 'Central API gateway — auth, LLM, telemetry, platform dispatch',
    version: '1.0.0',
    servers: [{ url: 'http://localhost:4000', description: 'Local dev' }],
    ui: !isProduction,
  });

  await app.register(fastifyCors, { origin: true });

  // ── Proxy upstreams ────────────────────────────────────────────────
  // Registered FIRST, before any hooks. Auth is handled by upstreams themselves.
  // @fastify/http-proxy with websocket:true intercepts upgrades at the HTTP
  // server level — no Fastify hooks must touch these requests.
  // Gateway is a dumb proxy — real per-route timeout enforcement lives in REST API.
  // 1 hour hard ceiling; anything longer should be a background job.
  const PROXY_TIMEOUT_MS = 3_600_000;

  for (const [name, upstream] of Object.entries(config.upstreams)) {
    await app.register(fastifyHttpProxy, {
      upstream: upstream.url,
      prefix: upstream.prefix,
      rewritePrefix: upstream.rewritePrefix ?? upstream.prefix,
      disableCache: true,
      websocket: upstream.websocket ?? false,
      http: {
        requestOptions: {
          timeout: PROXY_TIMEOUT_MS,
        },
      },
    });
    logger.info(`Upstream registered: ${name} → ${upstream.url} (${upstream.prefix}${upstream.websocket ? ', ws' : ''})`);
  }

  // ── Gateway's own routes (with auth) ───────────────────────────────
  // Encapsulated scope: auth hook only applies to gateway-owned routes,
  // not to proxy upstreams registered above.
  await app.register(async function gatewayRoutes(scope) {
    scope.addHook('onRequest', createAuthMiddleware(cache, jwtConfig));

    // Auth service + public routes (/auth/register, /auth/token, /auth/refresh)
    const authService = new AuthService(cache, jwtConfig);
    registerAuthRoutes(scope as unknown as Parameters<typeof registerAuthRoutes>[0], authService);

    // Health (public) — comprehensive adapter + upstream health
    const HEALTH_CACHE_KEY = '__gateway_health';
    const HEALTH_CACHE_TTL = 15_000; // 15s cache to prevent health DDoS
    const startupTime = Date.now();

    scope.get('/health', { schema: { tags: ['System'], summary: 'Gateway health check' } }, async () => {
      // Try to return cached health response
      try {
        const cached = await cache.get<Record<string, unknown>>(HEALTH_CACHE_KEY);
        if (cached) {return cached;}
      } catch { /* cache miss or error, compute fresh */ }

      const adapterNames = ['llm', 'cache', 'analytics', 'vectorStore', 'embeddings'] as const;
      const adapters: Record<string, { available: boolean; latencyMs?: number }> = {};

      for (const name of adapterNames) {
        const probeStart = Date.now();
        try {
          const adapter = (platform as any)[name];
          adapters[name] = { available: !!adapter, latencyMs: Date.now() - probeStart };
        } catch {
          adapters[name] = { available: false, latencyMs: Date.now() - probeStart };
        }
      }

      // Probe upstreams (HTTP GET /health with 2s timeout)
      const upstreams: Record<string, { status: string; latencyMs?: number }> = {};
      for (const [name, upstream] of Object.entries(config.upstreams)) {
        const probeStart = Date.now();
        try {
          const res = await fetch(`${upstream.url}/health`, {
            signal: AbortSignal.timeout(2000),
          });
          upstreams[name] = { status: res.ok ? 'up' : 'down', latencyMs: Date.now() - probeStart };
        } catch {
          upstreams[name] = { status: 'down', latencyMs: Date.now() - probeStart };
        }
      }

      // Derive overall status: LLM is critical
      const llmOk = adapters.llm?.available ?? false;
      const allOk = Object.values(adapters).every((a) => a.available);
      const status = llmOk ? (allOk ? 'healthy' : 'degraded') : 'unhealthy';

      const response = {
        status,
        version: '1.0',
        uptime: Math.floor((Date.now() - startupTime) / 1000),
        timestamp: new Date().toISOString(),
        adapters,
        upstreams,
      };

      // Cache for 15 seconds
      try {
        await cache.set(HEALTH_CACHE_KEY, response, HEALTH_CACHE_TTL);
      } catch { /* cache write failure is non-critical */ }

      return response;
    });

    // Host registration (public)
    // Use injected registry (with persistence) or fallback to cache-only
    if (!registry) {
      logger.warn('No persistent HostRegistry injected — hosts will be lost on restart');
    }
    const hostRegistry = registry ?? new HostRegistry(cache);
    scope.post('/hosts/register', { schema: { tags: ['Hosts'], summary: 'Register a host' } }, async (request, reply) => {
      const parsed = HostRegistrationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Bad Request', issues: parsed.error.issues });
      }
      const result = await hostRegistry.register(parsed.data);
      return reply.code(201).send({
        hostId: result.descriptor.hostId,
        machineToken: result.machineToken,
        status: result.descriptor.status,
      });
    });

    // List hosts (auth required)
    scope.get('/hosts', { schema: { tags: ['Hosts'], summary: 'List registered hosts' } }, async (request, reply) => {
      const auth = request.authContext;
      if (!auth) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      const hosts = await hostRegistry.list(auth.namespaceId);
      return { hosts };
    });

    // Get host by ID (auth required)
    scope.get<{ Params: { hostId: string } }>('/hosts/:hostId', { schema: { tags: ['Hosts'], summary: 'Get host by ID' } }, async (request, reply) => {
      const auth = request.authContext;
      if (!auth) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      const { hostId } = request.params;
      const host = await hostRegistry.get(hostId, auth.namespaceId);
      if (!host) {
        return reply.code(404).send({ error: 'Host not found' });
      }
      return host;
    });

    // Deregister host (auth required)
    scope.delete<{ Params: { hostId: string } }>('/hosts/:hostId', { schema: { tags: ['Hosts'], summary: 'Deregister a host' } }, async (request, reply) => {
      const auth = request.authContext;
      if (!auth) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      const { hostId } = request.params;
      const deleted = await hostRegistry.deregister(hostId, auth.namespaceId);
      if (!deleted) {
        return reply.code(404).send({ error: 'Host not found' });
      }
      return reply.code(204).send();
    });

    // Execute endpoint — public API for CLI/Studio clients (auth required)
    registerExecuteRoutes(scope as unknown as Parameters<typeof registerExecuteRoutes>[0], logger);

    // AI Gateway — OpenAI-compatible LLM endpoint (auth required)
    registerLLMGatewayRoutes(scope as unknown as Parameters<typeof registerLLMGatewayRoutes>[0], logger);

    // Telemetry ingestion — unified event collection (auth required)
    registerTelemetryRoutes(scope as unknown as Parameters<typeof registerTelemetryRoutes>[0], logger);

    // Unified Platform API — single dispatch for any adapter (auth required)
    registerPlatformRoutes(scope as unknown as Parameters<typeof registerPlatformRoutes>[0], logger);

    // Aggregated docs — /openapi-merged.json + /docs-all
    registerAggregatedDocsRoutes(scope as unknown as Parameters<typeof registerAggregatedDocsRoutes>[0], cache);

    // Internal dispatch endpoint
    const internalSecret = process.env.GATEWAY_INTERNAL_SECRET;
    scope.post('/internal/dispatch', async (request, reply) => {
      const provided = request.headers['x-internal-secret'];
      if (!internalSecret || provided !== internalSecret) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const body = request.body as {
        namespaceId?: string;
        hostId?: string;
        adapter?: string;
        method?: string;
        args?: unknown[];
      };

      if (!body.namespaceId || !body.adapter || !body.method) {
        return reply.code(400).send({ error: 'Missing required fields: namespaceId, adapter, method' });
      }

      const hostId = body.hostId
        ?? globalDispatcher.firstHostWithCapability(body.namespaceId, body.adapter)
        ?? globalDispatcher.firstHost(body.namespaceId);
      if (!hostId) {
        return reply.code(503).send({
          error: 'No host connected',
          namespaceId: body.namespaceId,
        });
      }

      try {
        const result = await globalDispatcher.call(
          body.namespaceId,
          hostId,
          body.adapter,
          body.method,
          body.args ?? [],
        );
        return { result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('Host not connected')) {
          return reply.code(503).send({ error: message });
        }
        return reply.code(502).send({ error: message });
      }
    });

    // Internal host resolution endpoint
    scope.post('/internal/resolve-host', async (request, reply) => {
      const provided = request.headers['x-internal-secret'];
      if (!internalSecret || provided !== internalSecret) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const body = request.body as {
        namespaceId?: string;
        target?: {
          hostId?: string;
          hostSelection?: string;
          repoFingerprint?: string;
        };
      };

      const namespaceId = body.namespaceId ?? 'default';
      const target = body.target ?? {};
      const strategy = (target.hostSelection ?? 'any-matching') as string;

      let hostId: string | undefined;

      if (strategy === 'pinned' && target.hostId) {
        // Verify host exists and is reachable (online or reconnecting)
        const host = await hostRegistry.get(target.hostId, namespaceId);
        if (host?.status === 'online' || host?.status === 'reconnecting') {
          hostId = target.hostId;
        }
      } else {
        // any-matching / prefer-local / prefer-cloud: find first with execution capability
        hostId = globalDispatcher.firstHostWithCapability(namespaceId, 'execution');
      }

      if (!hostId) {
        return reply.code(404).send({ error: 'No matching host found' });
      }

      return { hostId, strategy, namespaceId };
    });
  });

  // ── Gateway WebSocket endpoints ────────────────────────────────────
  // Must be after ready() so http-proxy's upgrade listener is registered.
  // attachGatewayWs captures it, removes it, and installs a unified handler
  // that dispatches gateway WS paths to raw ws handlers and delegates
  // everything else (upstream WS proxy) to http-proxy.
  await app.ready();
  attachGatewayWs(app.server, cache, jwtConfig, logger, registry);

  return app;
}
