import { platform } from '@kb-labs/core-runtime';
import { initializePlatform } from './platform.js';
import { loadGatewayConfig } from './config.js';
import { createServer } from './server.js';

export async function bootstrap(repoRoot: string = process.cwd()): Promise<void> {
  // 1. Initialize platform — loads adapters from kb.config.json
  // After this: platform.cache, platform.logger are available
  await initializePlatform(repoRoot);

  const logger = platform.logger.child({ layer: 'gateway', service: 'bootstrap' });
  logger.info('Platform initialized', { repoRoot });

  // 2. Load gateway config — reads gateway.upstreams from kb.config.json
  const config = await loadGatewayConfig(repoRoot);
  logger.info('Gateway config loaded', {
    port: config.port,
    upstreams: Object.keys(config.upstreams),
  });

  // 3. Create server
  const server = await createServer(config, platform.cache, platform.logger);

  // 4. Listen
  const address = await server.listen({ port: config.port, host: '0.0.0.0' });
  logger.info('Gateway listening', { address });

  // 5. Graceful shutdown
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
