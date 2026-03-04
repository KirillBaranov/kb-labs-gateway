import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HostRegistry } from '../hosts/registry.js';
import type { ICache } from '@kb-labs/core-platform';
import type { HostDescriptor } from '@kb-labs/gateway-contracts';

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

describe('HostRegistry.register', () => {
  it('creates a new host descriptor with offline status', async () => {
    const { cache } = makeCache();
    const registry = new HostRegistry(cache);

    const result = await registry.register({
      name: 'laptop',
      namespaceId: 'ns-1',
      capabilities: ['filesystem', 'git'],
      workspacePaths: ['/home/user/projects'],
    });

    expect(result.descriptor.name).toBe('laptop');
    expect(result.descriptor.namespaceId).toBe('ns-1');
    expect(result.descriptor.status).toBe('offline');
    expect(result.descriptor.capabilities).toEqual(['filesystem', 'git']);
    expect(result.descriptor.connections).toEqual([]);
    expect(result.descriptor.hostId).toBeTypeOf('string');
    expect(result.machineToken).toBeTypeOf('string');
    expect(result.machineToken).not.toBe(result.descriptor.hostId);
  });

  it('stores descriptor and token in cache', async () => {
    const { cache, store } = makeCache();
    const registry = new HostRegistry(cache);

    const result = await registry.register({
      name: 'srv',
      namespaceId: 'ns-2',
      capabilities: ['filesystem'],
      workspacePaths: [],
    });

    const registryKey = `host:registry:ns-2:${result.descriptor.hostId}`;
    const tokenKey = `host:token:${result.machineToken}`;

    expect(store.has(registryKey)).toBe(true);
    expect(store.has(tokenKey)).toBe(true);

    const tokenEntry = store.get(tokenKey) as { hostId: string; namespaceId: string };
    expect(tokenEntry.hostId).toBe(result.descriptor.hostId);
    expect(tokenEntry.namespaceId).toBe('ns-2');
  });

  it('generates unique hostId and token per registration', async () => {
    const { cache } = makeCache();
    const registry = new HostRegistry(cache);
    const reg = { name: 'h', namespaceId: 'ns', capabilities: [] as [], workspacePaths: [] };

    const r1 = await registry.register(reg);
    const r2 = await registry.register(reg);

    expect(r1.descriptor.hostId).not.toBe(r2.descriptor.hostId);
    expect(r1.machineToken).not.toBe(r2.machineToken);
  });
});

describe('HostRegistry.setOnline / setOffline', () => {
  let cache: ICache;
  let store: Map<string, unknown>;
  let registry: HostRegistry;
  let hostId: string;

  beforeEach(async () => {
    ({ cache, store } = makeCache());
    registry = new HostRegistry(cache);
    const result = await registry.register({
      name: 'test-host', namespaceId: 'ns-1', capabilities: ['filesystem'], workspacePaths: [],
    });
    hostId = result.descriptor.hostId;
  });

  it('sets status to online and adds connectionId', async () => {
    await registry.setOnline(hostId, 'ns-1', 'conn-a');
    const host = store.get(`host:registry:ns-1:${hostId}`) as HostDescriptor;
    expect(host.status).toBe('online');
    expect(host.connections).toContain('conn-a');
  });

  it('deduplicates connections on repeated setOnline', async () => {
    await registry.setOnline(hostId, 'ns-1', 'conn-a');
    await registry.setOnline(hostId, 'ns-1', 'conn-a');
    const host = store.get(`host:registry:ns-1:${hostId}`) as HostDescriptor;
    expect(host.connections).toHaveLength(1);
  });

  it('supports multiple connections', async () => {
    await registry.setOnline(hostId, 'ns-1', 'conn-a');
    await registry.setOnline(hostId, 'ns-1', 'conn-b');
    const host = store.get(`host:registry:ns-1:${hostId}`) as HostDescriptor;
    expect(host.connections).toHaveLength(2);
    expect(host.status).toBe('online');
  });

  it('sets offline when last connection removed', async () => {
    await registry.setOnline(hostId, 'ns-1', 'conn-a');
    await registry.setOffline(hostId, 'ns-1', 'conn-a');
    const host = store.get(`host:registry:ns-1:${hostId}`) as HostDescriptor;
    expect(host.status).toBe('offline');
    expect(host.connections).toHaveLength(0);
  });

  it('stays online when one connection of many is removed', async () => {
    await registry.setOnline(hostId, 'ns-1', 'conn-a');
    await registry.setOnline(hostId, 'ns-1', 'conn-b');
    await registry.setOffline(hostId, 'ns-1', 'conn-a');
    const host = store.get(`host:registry:ns-1:${hostId}`) as HostDescriptor;
    expect(host.status).toBe('online');
    expect(host.connections).toEqual(['conn-b']);
  });

  it('does nothing if host not found', async () => {
    await expect(registry.setOnline('nonexistent', 'ns-1', 'conn-x')).resolves.toBeUndefined();
    await expect(registry.setOffline('nonexistent', 'ns-1', 'conn-x')).resolves.toBeUndefined();
  });
});

describe('HostRegistry.heartbeat', () => {
  it('updates lastSeen timestamp', async () => {
    const { cache, store } = makeCache();
    const registry = new HostRegistry(cache);
    const before = Date.now();

    const { descriptor } = await registry.register({
      name: 'h', namespaceId: 'ns', capabilities: [], workspacePaths: [],
    });

    await new Promise((r) => { setTimeout(r, 5); }); // small delay
    await registry.heartbeat(descriptor.hostId, 'ns');

    const host = store.get(`host:registry:ns:${descriptor.hostId}`) as HostDescriptor;
    expect(host.lastSeen).toBeGreaterThan(before);
  });
});

describe('HostRegistry.get', () => {
  it('returns host descriptor by id', async () => {
    const { cache } = makeCache();
    const registry = new HostRegistry(cache);
    const { descriptor } = await registry.register({
      name: 'h', namespaceId: 'ns', capabilities: [], workspacePaths: [],
    });

    const found = await registry.get(descriptor.hostId, 'ns');
    expect(found).not.toBeNull();
    expect(found!.hostId).toBe(descriptor.hostId);
  });

  it('returns null for unknown host', async () => {
    const { cache } = makeCache();
    const registry = new HostRegistry(cache);
    expect(await registry.get('ghost', 'ns')).toBeNull();
  });
});

describe('HostRegistry.resolveToken', () => {
  it('returns hostId/namespaceId for valid machine token', async () => {
    const { cache } = makeCache();
    const registry = new HostRegistry(cache);
    const { machineToken, descriptor } = await registry.register({
      name: 'h', namespaceId: 'ns-1', capabilities: [], workspacePaths: [],
    });

    const resolved = await registry.resolveToken(machineToken);
    expect(resolved).not.toBeNull();
    expect(resolved!.hostId).toBe(descriptor.hostId);
    expect(resolved!.namespaceId).toBe('ns-1');
  });

  it('returns null for unknown token', async () => {
    const { cache } = makeCache();
    const registry = new HostRegistry(cache);
    expect(await registry.resolveToken('bad-token')).toBeNull();
  });
});
