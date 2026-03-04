import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import fastifyHttpProxy from '@fastify/http-proxy';
import type { ICache, ILogger } from '@kb-labs/core-platform';
import type { GatewayConfig } from '@kb-labs/gateway-contracts';
import { HostRegistrationSchema } from '@kb-labs/gateway-contracts';
import { AuthService, type JwtConfig } from '@kb-labs/gateway-auth';
import { createAuthMiddleware } from './auth/middleware.js';
import { registerAuthRoutes } from './auth/routes.js';
import { HostRegistry } from './hosts/registry.js';
import { createWsHandler } from './hosts/ws-handler.js';

function pinoCompatibleLogger(logger: ILogger) {
  return {
    trace: (msg: string, ...args: unknown[]) => logger.debug(msg, ...args),
    debug: (msg: string, ...args: unknown[]) => logger.debug(msg, ...args),
    info: (msg: string, ...args: unknown[]) => logger.info(msg, ...args),
    warn: (msg: string, ...args: unknown[]) => logger.warn(msg, ...args),
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
) {
  const app = Fastify({
    loggerInstance: pinoCompatibleLogger(logger) as unknown as Parameters<typeof Fastify>[0]['loggerInstance'],
  });

  // Plugins
  await app.register(fastifyWebsocket);
  await app.register(fastifyCors, { origin: true });

  // Auth middleware for all routes (onRequest fires before routing — applies to proxy plugins too)
  app.addHook('onRequest', createAuthMiddleware(cache, jwtConfig));

  // Auth service + public routes (/auth/register, /auth/token, /auth/refresh)
  const authService = new AuthService(cache, jwtConfig);
  registerAuthRoutes(app, authService);

  // Health (public)
  app.get('/health', async () => ({ status: 'ok', version: '1.0' }));

  // Host registration (public)
  const registry = new HostRegistry(cache);
  app.post('/hosts/register', async (request, reply) => {
    const parsed = HostRegistrationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Bad Request', issues: parsed.error.issues });
    }
    const result = await registry.register(parsed.data);
    return reply.code(201).send({
      hostId: result.descriptor.hostId,
      machineToken: result.machineToken,
      status: result.descriptor.status,
    });
  });

  // WebSocket — Host Agent connection
  app.get('/hosts/connect', { websocket: true }, createWsHandler(cache));

  // List hosts (auth required)
  app.get('/hosts', async (request, reply) => {
    const auth = request.authContext;
    if (!auth) {return reply.code(401).send({ error: 'Unauthorized' });}
    // TODO: scan cache by namespace pattern — return registered hosts
    return { hosts: [] };
  });

  // Declarative proxy — register one handler per upstream from config
  for (const [name, upstream] of Object.entries(config.upstreams)) {
    await app.register(fastifyHttpProxy, {
      upstream: upstream.url,
      prefix: upstream.prefix,
      rewritePrefix: upstream.prefix,
      disableCache: true,
    });
    logger.info(`Upstream registered: ${name} → ${upstream.url} (${upstream.prefix})`);
  }

  return app;
}
