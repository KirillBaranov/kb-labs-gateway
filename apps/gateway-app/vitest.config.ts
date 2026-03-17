import { mergeConfig } from 'vitest/config';
import base from '@kb-labs/devkit/vitest/node.js';

/**
 * Gateway app vitest config.
 *
 * live-gateway.e2e.test.ts is excluded from the default test run because it
 * requires a standalone Gateway instance (no upstream proxy for /api/v1).
 * In the standard dev setup the gateway proxies /api/v1 to the REST API,
 * which shadows the gateway's own execute routes.
 *
 * To run the live tests: vitest run src/__tests__/live-gateway.e2e.test.ts
 */
export default mergeConfig(base, {
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.live.test.ts',
      '**/live-gateway.e2e.test.ts',
    ],
  },
});
