import { randomUUID } from 'node:crypto';
import type { ICache } from '@kb-labs/core-platform';
import type { HostDescriptor, HostRegistration, IHostStore } from '@kb-labs/gateway-contracts';

export interface HostRegisterResult {
  descriptor: HostDescriptor;
  machineToken: string;
}

/**
 * Host Registry — coordinates cache (hot) and store (cold) layers.
 *
 * - Cache: online/offline status, connections, heartbeat (transient)
 * - Store: host descriptors, tokens (durable, survives restarts)
 *
 * Write path: store.save() + cache.set()
 * Read path: cache.get() ?? store.get() → cache warm
 */
const DEFAULT_RECONNECT_GRACE_MS = 10_000;

export class HostRegistry {
  private readonly graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly reconnectGraceMs: number;

  constructor(
    private readonly cache: ICache,
    private readonly store?: IHostStore,
    options?: { reconnectGraceMs?: number },
  ) {
    this.reconnectGraceMs = options?.reconnectGraceMs ?? DEFAULT_RECONNECT_GRACE_MS;
  }

  /**
   * Restore hosts from persistent store into cache on startup.
   * All restored hosts start as offline — live status comes from WS connections.
   */
  async restore(): Promise<number> {
    if (!this.store) {return 0;}
    const hosts = await this.store.listAll();
    for (const host of hosts) {
      const cacheKey = this.hostKey(host.namespaceId, host.hostId);
      await this.cache.set(cacheKey, { ...host, status: 'offline', connections: [] });
      await this.addToIndex(host.namespaceId, host.hostId);
    }
    return hosts.length;
  }

  async register(reg: HostRegistration): Promise<HostRegisterResult> {
    const hostId = `host_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const machineToken = randomUUID();
    const now = Date.now();

    const descriptor: HostDescriptor = {
      hostId,
      name: reg.name,
      namespaceId: reg.namespaceId,
      capabilities: reg.capabilities,
      status: 'offline',
      lastSeen: now,
      connections: [],
      hostType: reg.hostType,
      createdAt: now,
      updatedAt: now,
    };

    // Persist to store (durable)
    if (this.store) {
      await this.store.save(descriptor);
      await this.store.saveToken(machineToken, hostId, reg.namespaceId);
    }

    // Write to cache (hot)
    await this.cache.set(this.hostKey(reg.namespaceId, hostId), descriptor);
    await this.cache.set(this.tokenKey(machineToken), { hostId, namespaceId: reg.namespaceId });
    await this.addToIndex(reg.namespaceId, hostId);

    return { descriptor, machineToken };
  }

  async setOnline(hostId: string, namespaceId: string, connectionId: string): Promise<void> {
    const host = await this.getFromCache(hostId, namespaceId);
    if (!host) {return;}

    // Cancel grace timer if reconnecting
    const graceKey = `${namespaceId}:${hostId}`;
    const graceTimer = this.graceTimers.get(graceKey);
    if (graceTimer) {
      clearTimeout(graceTimer);
      this.graceTimers.delete(graceKey);
    }

    await this.cache.set(this.hostKey(namespaceId, hostId), {
      ...host,
      status: 'online',
      lastSeen: Date.now(),
      connections: [connectionId],
    });
  }

  async setOffline(hostId: string, namespaceId: string, connectionId: string): Promise<void> {
    const host = await this.getFromCache(hostId, namespaceId);
    if (!host) {return;}
    const connections = host.connections.filter((c) => c !== connectionId);

    if (connections.length > 0) {
      // Other connections still active — stay online
      await this.cache.set(this.hostKey(namespaceId, hostId), {
        ...host, status: 'online', lastSeen: Date.now(), connections,
      });
      return;
    }

    // Last connection gone — enter grace period (reconnecting)
    await this.cache.set(this.hostKey(namespaceId, hostId), {
      ...host, status: 'reconnecting', lastSeen: Date.now(), connections: [],
    });

    // Cancel any existing grace timer for this host
    const graceKey = `${namespaceId}:${hostId}`;
    const existing = this.graceTimers.get(graceKey);
    if (existing) {clearTimeout(existing);}

    // After grace period, mark truly offline
    this.graceTimers.set(graceKey, setTimeout(async () => {
      this.graceTimers.delete(graceKey);
      const current = await this.getFromCache(hostId, namespaceId);
      if (current?.status === 'reconnecting') {
        await this.cache.set(this.hostKey(namespaceId, hostId), {
          ...current, status: 'offline', lastSeen: Date.now(),
        });
      }
    }, this.reconnectGraceMs));
  }

  async heartbeat(hostId: string, namespaceId: string): Promise<void> {
    const host = await this.getFromCache(hostId, namespaceId);
    if (!host) {return;}
    await this.cache.set(this.hostKey(namespaceId, hostId), { ...host, lastSeen: Date.now() });
  }

  async get(hostId: string, namespaceId: string): Promise<HostDescriptor | null> {
    // Try cache first (hot)
    const cached = await this.cache.get<HostDescriptor>(this.hostKey(namespaceId, hostId));
    if (cached) {return cached;}

    // Fall through to store (cold)
    if (!this.store) {return null;}
    const stored = await this.store.get(hostId, namespaceId);
    if (!stored) {return null;}

    // Warm cache
    await this.cache.set(this.hostKey(namespaceId, hostId), { ...stored, status: 'offline', connections: [] });
    await this.addToIndex(namespaceId, hostId);
    return { ...stored, status: 'offline', connections: [] };
  }

  async resolveToken(token: string): Promise<{ hostId: string; namespaceId: string } | null> {
    // Try cache first
    const cached = await this.cache.get<{ hostId: string; namespaceId: string }>(this.tokenKey(token));
    if (cached) {return cached;}

    // Fall through to store
    if (!this.store) {return null;}
    const stored = await this.store.resolveToken(token);
    if (!stored) {return null;}

    // Warm cache
    await this.cache.set(this.tokenKey(token), stored);
    return stored;
  }

  async list(namespaceId: string): Promise<HostDescriptor[]> {
    // Use store as authoritative source if available
    if (this.store) {
      const persisted = await this.store.list(namespaceId);
      // Enrich with live status from cache
      return Promise.all(
        persisted.map(async (host) => {
          const cached = await this.cache.get<HostDescriptor>(this.hostKey(namespaceId, host.hostId));
          return cached ?? { ...host, status: 'offline' as const, connections: [] };
        }),
      );
    }

    // Fallback: cache-only (no store)
    const indexKey = `host:index:${namespaceId}`;
    const hostIds = (await this.cache.get<string[]>(indexKey)) ?? [];
    const results = await Promise.all(
      hostIds.map((id) => this.cache.get<HostDescriptor>(this.hostKey(namespaceId, id))),
    );
    return results.filter((h): h is HostDescriptor => h !== null);
  }

  async deregister(hostId: string, namespaceId: string): Promise<boolean> {
    // Remove from store
    const deleted = this.store ? await this.store.delete(hostId, namespaceId) : false;

    // Remove from cache
    await this.cache.delete(this.hostKey(namespaceId, hostId));
    await this.removeFromIndex(namespaceId, hostId);

    return deleted;
  }

  async ensureRegistered(
    hostId: string,
    namespaceId: string,
    name: string,
    capabilities: HostDescriptor['capabilities'] = [],
  ): Promise<void> {
    const existing = await this.get(hostId, namespaceId);
    if (existing) {
      if (capabilities.length > 0 && JSON.stringify(existing.capabilities) !== JSON.stringify(capabilities)) {
        const updated = { ...existing, capabilities, updatedAt: Date.now() };
        if (this.store) {await this.store.save(updated);}
        await this.cache.set(this.hostKey(namespaceId, hostId), updated);
      }
      return;
    }

    const now = Date.now();
    const descriptor: HostDescriptor = {
      hostId,
      name,
      namespaceId,
      capabilities,
      status: 'offline',
      lastSeen: now,
      connections: [],
      createdAt: now,
      updatedAt: now,
    };

    if (this.store) {await this.store.save(descriptor);}
    await this.cache.set(this.hostKey(namespaceId, hostId), descriptor);
    await this.addToIndex(namespaceId, hostId);
  }

  // ── Private helpers ──────────────────────────────────────────────

  private hostKey(namespaceId: string, hostId: string): string {
    return `host:registry:${namespaceId}:${hostId}`;
  }

  private tokenKey(token: string): string {
    return `host:token:${token}`;
  }

  private async getFromCache(hostId: string, namespaceId: string): Promise<HostDescriptor | null> {
    return this.cache.get<HostDescriptor>(this.hostKey(namespaceId, hostId));
  }

  private async addToIndex(namespaceId: string, hostId: string): Promise<void> {
    const indexKey = `host:index:${namespaceId}`;
    const hostIds = (await this.cache.get<string[]>(indexKey)) ?? [];
    if (!hostIds.includes(hostId)) {
      await this.cache.set(indexKey, [...hostIds, hostId]);
    }
  }

  private async removeFromIndex(namespaceId: string, hostId: string): Promise<void> {
    const indexKey = `host:index:${namespaceId}`;
    const hostIds = (await this.cache.get<string[]>(indexKey)) ?? [];
    await this.cache.set(indexKey, hostIds.filter((id) => id !== hostId));
  }
}
