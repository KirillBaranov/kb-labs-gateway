/**
 * Static serving for plugin widget bundles (Module Federation remotes).
 *
 * Route: GET /plugins/@scope/name/widgets/*
 * Resolves files from node_modules/@scope/name/dist/widgets/*
 *
 * Auth-gated — must be registered inside the auth scope.
 * Plugin bundles are code and may be private/proprietary.
 *
 * Cache-Control: immutable for hashed chunks, short-lived for remoteEntry.js
 * (remoteEntry.js is the MF manifest — browser must check for updates).
 */

import { FastifyInstance } from 'fastify';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';

const MIME_TYPES: Record<string, string> = {
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/**
 * Register plugin widget static file routes.
 * Must be registered INSIDE the auth-gated scope — bundles are protected.
 */
export function registerWidgetStaticRoutes(
  app: FastifyInstance,
  repoRoot: string,
): void {
  // GET /plugins/@scope/name/widgets/*
  app.get<{
    Params: { scope: string; name: string; '*': string };
  }>('/plugins/@:scope/:name/widgets/*', {
    schema: {
      // Hide from OpenAPI — internal static serving
      hide: true,
    },
  }, async (request, reply) => {
    const { scope, name } = request.params;
    const filePath = request.params['*'];

    // Sanitize: prevent path traversal
    if (!scope || !name || !filePath || filePath.includes('..') || scope.includes('..') || name.includes('..')) {
      return reply.code(400).send({ error: 'Invalid path' });
    }

    const packageDir = resolve(repoRoot, 'node_modules', `@${scope}`, name);
    const fullPath = join(packageDir, 'dist', 'widgets', filePath);

    // Ensure resolved path is still within packageDir (double-check traversal)
    if (!fullPath.startsWith(packageDir)) {
      return reply.code(400).send({ error: 'Invalid path' });
    }

    if (!existsSync(fullPath)) {
      return reply.code(404).send({ error: `Widget file not found: @${scope}/${name}/widgets/${filePath}` });
    }

    const stat = statSync(fullPath);
    if (!stat.isFile()) {
      return reply.code(404).send({ error: 'Not a file' });
    }

    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';

    // remoteEntry.js must be re-validated — it's the MF manifest
    // Hashed chunk files (e.g. assets/chunk-abc123.js) are immutable
    const isEntry = filePath === 'remoteEntry.js';
    const cacheControl = isEntry
      ? 'public, max-age=10, must-revalidate'
      : 'public, max-age=31536000, immutable';

    return reply
      .code(200)
      .header('Content-Type', contentType)
      .header('Content-Length', stat.size)
      .header('Cache-Control', cacheControl)
      .header('Access-Control-Allow-Origin', '*')
      .send(createReadStream(fullPath));
  });
}
