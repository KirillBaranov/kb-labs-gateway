import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import type { ICache, ILogger } from '@kb-labs/core-platform';
import { HostRegistrationSchema } from '@kb-labs/gateway-contracts';
import { createAuthMiddleware } from '../auth/middleware.js';
import type { JwtConfig } from '@kb-labs/gateway-auth';
import { HostRegistry } from '../hosts/registry.js';
import { createWsHandler } from '../hosts/ws-handler.js';

// ── Minimal mocks ────────────────────────────────────────────────────────────

function makeCache(): { cache: ICache; store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  const cache: ICache = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
    clear: vi.fn(async () => { store.clear(); }),
  } as unknown as ICache;
  return { cache, store };
}

const noopLogger: ILogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(() => noopLogger),
} as unknown as ILogger;

// Build a minimal Fastify app matching server.ts structure (without proxy)
const stubJwtConfig: JwtConfig = { secret: 'test-secret' };

async function buildApp(cache: ICache): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(fastifyWebsocket);
  await app.register(fastifyCors, { origin: true });
  app.addHook('preHandler', createAuthMiddleware(cache, stubJwtConfig));

  app.get('/health', async () => ({ status: 'ok', version: '1.0' }));

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

  app.get('/hosts', async (request, reply) => {
    const auth = request.authContext;
    if (!auth) {return reply.code(401).send({ error: 'Unauthorized' });}
    return { hosts: [] };
  });

  app.get('/hosts/connect', { websocket: true }, createWsHandler(cache));

  await app.ready();
  return app;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GET /health (public)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const { cache } = makeCache();
    app = await buildApp(cache);
  });

  afterEach(async () => { await app.close(); });

  it('returns 200 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', version: '1.0' });
  });
});

describe('POST /hosts/register (public)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const { cache } = makeCache();
    app = await buildApp(cache);
  });

  afterEach(async () => { await app.close(); });

  it('registers a host and returns 201 with hostId + machineToken', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/hosts/register',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'laptop',
        namespaceId: 'ns-1',
        capabilities: ['filesystem', 'git'],
        workspacePaths: ['/home/user/projects'],
      }),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.hostId).toBeTypeOf('string');
    expect(body.machineToken).toBeTypeOf('string');
    expect(body.status).toBe('offline');
  });

  it('returns 400 for missing required fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/hosts/register',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'laptop' }), // missing namespaceId, capabilities, workspacePaths
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('Bad Request');
    expect(body.issues).toBeDefined();
  });

  it('returns 400 for invalid capability enum value', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/hosts/register',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'h',
        namespaceId: 'ns',
        capabilities: ['invalid-capability'],
        workspacePaths: [],
      }),
    });

    expect(res.statusCode).toBe(400);
  });

  it('does not require auth', async () => {
    // No Authorization header
    const res = await app.inject({
      method: 'POST',
      url: '/hosts/register',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'h', namespaceId: 'ns', capabilities: [], workspacePaths: [] }),
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('Auth middleware', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const { cache } = makeCache();
    app = await buildApp(cache);
  });

  afterEach(async () => { await app.close(); });

  it('returns 401 for protected routes without Authorization', async () => {
    const res = await app.inject({ method: 'GET', url: '/hosts' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Unauthorized');
  });

  it('returns 401 for unknown Bearer token (no CLI fallback)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/hosts',
      headers: { authorization: 'Bearer some-random-token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('passes protected routes with valid machine token', async () => {
    const { cache } = makeCache();
    const localApp = await buildApp(cache);

    const regRes = await localApp.inject({
      method: 'POST',
      url: '/hosts/register',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'h', namespaceId: 'ns', capabilities: [], workspacePaths: [] }),
    });
    const { machineToken } = regRes.json();

    const res = await localApp.inject({
      method: 'GET',
      url: '/hosts',
      headers: { authorization: `Bearer ${machineToken}` },
    });
    expect(res.statusCode).toBe(200);
    await localApp.close();
  });

  it('/health is public — no 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).not.toBe(401);
  });

  it('/hosts/register is public — no 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/hosts/register',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'h', namespaceId: 'ns', capabilities: [], workspacePaths: [] }),
    });
    expect(res.statusCode).not.toBe(401);
  });

  it('machine token resolves correctly', async () => {
    const { cache } = makeCache();
    const localApp = await buildApp(cache);

    // Register host to get machine token
    const regRes = await localApp.inject({
      method: 'POST',
      url: '/hosts/register',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'h', namespaceId: 'ns', capabilities: [], workspacePaths: [] }),
    });
    const { machineToken } = regRes.json();

    // Use machine token on protected route
    const res = await localApp.inject({
      method: 'GET',
      url: '/hosts',
      headers: { authorization: `Bearer ${machineToken}` },
    });
    expect(res.statusCode).toBe(200);
    await localApp.close();
  });
});
