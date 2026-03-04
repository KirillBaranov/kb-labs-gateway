import type { FastifyRequest, FastifyReply } from 'fastify';
import type { ICache } from '@kb-labs/core-platform';
import type { AuthContext } from '@kb-labs/gateway-contracts';
import { resolveToken, extractBearerToken } from './tokens.js';

// Routes that don't require auth
const PUBLIC_ROUTES = new Set(['/health', '/hosts/register']);

declare module 'fastify' {
  interface FastifyRequest {
    authContext?: AuthContext;
  }
}

export function createAuthMiddleware(cache: ICache) {
  return async function authMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const rawPath = request.routeOptions.url ?? new URL(request.url, 'http://localhost').pathname;
    const routePath = rawPath.replace(/\/+/g, '/').replace(/\/+$/, '') || '/';
    if (PUBLIC_ROUTES.has(routePath)) {return;}

    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Missing Authorization header' });
    }

    const authContext = await resolveToken(token, cache);
    if (!authContext) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid token' });
    }

    request.authContext = authContext;
  };
}
