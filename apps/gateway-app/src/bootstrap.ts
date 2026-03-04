import { platform, createServiceBootstrap } from '@kb-labs/core-runtime';
import { loadGatewayConfig } from './config.js';
import { createServer } from './server.js';

export async function bootstrap(repoRoot: string = process.cwd()): Promise<void> {
  // 1. Initialize platform (loads .env + adapters from kb.config.json)
  await createServiceBootstrap({ appId: 'gateway', repoRoot });

  const logger = platform.logger.child({ layer: 'gateway', service: 'bootstrap' });
  logger.info('Platform initialized', { repoRoot });

  // 2. Load gateway config — reads gateway.upstreams from kb.config.json
  const config = await loadGatewayConfig(repoRoot);
  logger.info('Gateway config loaded', {
    port: config.port,
    upstreams: Object.keys(config.upstreams),
  });

  // 3. Seed static tokens into ICache so resolveToken() accepts them
  for (const [token, entry] of Object.entries(config.staticTokens)) {
    await platform.cache.set(`host:token:${token}`, entry);
    logger.info('Static token seeded', { hostId: entry.hostId, namespaceId: entry.namespaceId });
  }

  // 4. Build JWT config — secret from env, required in production
  const jwtSecret = process.env.GATEWAY_JWT_SECRET;
  if (!jwtSecret) {
    logger.warn('GATEWAY_JWT_SECRET not set — using insecure default (dev only!)');
  }
  const jwtConfig = { secret: jwtSecret ?? 'dev-insecure-secret-change-me' };

  // 5. Create server
  const server = await createServer(config, platform.cache, platform.logger, jwtConfig);

  // 6. Listen
  const address = await server.listen({ port: config.port, host: '0.0.0.0' });
  logger.info('Gateway listening', { address });

  // 7. Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.warn('Received shutdown signal', { signal });
    await platform.shutdown();
    await server.close();
    logger.info('Gateway shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
