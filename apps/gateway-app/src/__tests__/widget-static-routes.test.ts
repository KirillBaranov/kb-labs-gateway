import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OperationMetricsTracker } from '@kb-labs/shared-http';
import { registerWidgetStaticRoutes } from '../widgets/routes.js';

describe('registerWidgetStaticRoutes', () => {
  let app: ReturnType<typeof Fastify>;
  let repoRoot: string;
  let metrics: OperationMetricsTracker;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    repoRoot = await mkdtemp(join(tmpdir(), 'kb-gateway-widgets-'));
    metrics = new OperationMetricsTracker();
    registerWidgetStaticRoutes(app, repoRoot, metrics);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('serves widget bundles and records gateway widget operations', async () => {
    const widgetsDir = join(repoRoot, 'node_modules', '@demo', 'test-widget', 'dist', 'widgets');
    await mkdir(widgetsDir, { recursive: true });
    await writeFile(join(widgetsDir, 'remoteEntry.js'), 'export default "ok";');

    const response = await app.inject({
      method: 'GET',
      url: '/plugins/@demo/test-widget/widgets/remoteEntry.js',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toContain('must-revalidate');
    expect(response.body).toContain('export default');
    expect(metrics.getMetricLines()).toEqual(
      expect.arrayContaining([
        expect.stringContaining('service_operation_total{operation="gateway.widgets.bundle",status="ok"}'),
      ]),
    );
  });

  it('records an error operation for missing widget bundles', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/plugins/@demo/missing/widgets/remoteEntry.js',
    });

    expect(response.statusCode).toBe(404);
    expect(metrics.getMetricLines()).toEqual(
      expect.arrayContaining([
        expect.stringContaining('service_operation_total{operation="gateway.widgets.bundle",status="error"}'),
      ]),
    );
  });
});
