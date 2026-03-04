/**
 * Auth routes — public endpoints for agent registration and token management.
 * POST /auth/register  — register new agent, get clientId + clientSecret
 * POST /auth/token     — exchange credentials for JWT pair
 * POST /auth/refresh   — rotate refresh token, get new pair
 */

import type { FastifyInstance } from 'fastify';
import { AuthService } from '@kb-labs/gateway-auth';
import {
  RegisterRequestSchema,
  TokenRequestSchema,
  RefreshRequestSchema,
} from '@kb-labs/gateway-contracts';

export function registerAuthRoutes(app: FastifyInstance, authService: AuthService): void {
  // Register new agent
  app.post('/auth/register', async (request, reply) => {
    const parsed = RegisterRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Bad Request', issues: parsed.error.issues });
    }

    const result = await authService.register(parsed.data);
    return reply.code(201).send(result);
  });

  // Issue token pair
  app.post('/auth/token', async (request, reply) => {
    const parsed = TokenRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Bad Request', issues: parsed.error.issues });
    }

    const tokens = await authService.issueTokens(parsed.data.clientId, parsed.data.clientSecret);
    if (!tokens) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid credentials' });
    }

    return reply.send(tokens);
  });

  // Refresh token pair
  app.post('/auth/refresh', async (request, reply) => {
    const parsed = RefreshRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Bad Request', issues: parsed.error.issues });
    }

    const tokens = await authService.refreshTokens(parsed.data.refreshToken);
    if (!tokens) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or expired refresh token' });
    }

    return reply.send(tokens);
  });
}
