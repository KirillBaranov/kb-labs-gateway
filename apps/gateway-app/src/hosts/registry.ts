import { randomUUID } from 'node:crypto';
import type { ICache } from '@kb-labs/core-platform';
import type { HostDescriptor, HostRegistration } from '@kb-labs/gateway-contracts';

export interface HostRegisterResult {
  descriptor: HostDescriptor;
  machineToken: string;
}

export class HostRegistry {
  constructor(private readonly cache: ICache) {}

  async register(reg: HostRegistration): Promise<HostRegisterResult> {
    const hostId = randomUUID();
    const machineToken = randomUUID();

    const descriptor: HostDescriptor = {
      hostId,
      name: reg.name,
      namespaceId: reg.namespaceId,
      capabilities: reg.capabilities,
      status: 'offline',
      lastSeen: Date.now(),
      connections: [],
    };

    await this.cache.set(`host:registry:${reg.namespaceId}:${hostId}`, descriptor);
    await this.cache.set(`host:token:${machineToken}`, {
      hostId,
      namespaceId: reg.namespaceId,
    });

    // Maintain namespace index so list() can find this host
    const indexKey = `host:index:${reg.namespaceId}`;
    const hostIds = (await this.cache.get<string[]>(indexKey)) ?? [];
    if (!hostIds.includes(hostId)) {
      await this.cache.set(indexKey, [...hostIds, hostId]);
    }

    return { descriptor, machineToken };
  }

  async setOnline(hostId: string, namespaceId: string, connectionId: string): Promise<void> {
    const key = `host:registry:${namespaceId}:${hostId}`;
    const host = await this.cache.get<HostDescriptor>(key);
    if (!host) {return;}
    // One active connection per connect event — replace stale list from previous runs
    await this.cache.set(key, { ...host, status: 'online', lastSeen: Date.now(), connections: [connectionId] });
  }

  async setOffline(hostId: string, namespaceId: string, connectionId: string): Promise<void> {
    const key = `host:registry:${namespaceId}:${hostId}`;
    const host = await this.cache.get<HostDescriptor>(key);
    if (!host) {return;}
    const connections = host.connections.filter((c) => c !== connectionId);
    const status = connections.length > 0 ? 'online' : 'offline';
    await this.cache.set(key, { ...host, status, lastSeen: Date.now(), connections });
  }

  async heartbeat(hostId: string, namespaceId: string): Promise<void> {
    const key = `host:registry:${namespaceId}:${hostId}`;
    const host = await this.cache.get<HostDescriptor>(key);
    if (!host) {return;}
    await this.cache.set(key, { ...host, lastSeen: Date.now() });
  }

  async get(hostId: string, namespaceId: string): Promise<HostDescriptor | null> {
    return this.cache.get<HostDescriptor>(`host:registry:${namespaceId}:${hostId}`);
  }

  async resolveToken(token: string): Promise<{ hostId: string; namespaceId: string } | null> {
    return this.cache.get<{ hostId: string; namespaceId: string }>(`host:token:${token}`);
  }

  async list(namespaceId: string): Promise<HostDescriptor[]> {
    const indexKey = `host:index:${namespaceId}`;
    const hostIds = (await this.cache.get<string[]>(indexKey)) ?? [];
    const results = await Promise.all(
      hostIds.map((id) => this.cache.get<HostDescriptor>(`host:registry:${namespaceId}:${id}`)),
    );
    return results.filter((h): h is HostDescriptor => h !== null);
  }

  async ensureRegistered(
    hostId: string,
    namespaceId: string,
    name: string,
    capabilities: HostDescriptor['capabilities'] = [],
  ): Promise<void> {
    const key = `host:registry:${namespaceId}:${hostId}`;
    const existing = await this.cache.get<HostDescriptor>(key);
    if (existing) {
      // Update capabilities if they changed since last registration
      if (capabilities.length > 0 && JSON.stringify(existing.capabilities) !== JSON.stringify(capabilities)) {
        await this.cache.set(key, { ...existing, capabilities });
      }
      return;
    }

    const descriptor: HostDescriptor = {
      hostId,
      name,
      namespaceId,
      capabilities,
      status: 'offline',
      lastSeen: Date.now(),
      connections: [],
    };
    await this.cache.set(key, descriptor);

    // Maintain namespace index
    const indexKey = `host:index:${namespaceId}`;
    const hostIds = (await this.cache.get<string[]>(indexKey)) ?? [];
    if (!hostIds.includes(hostId)) {
      await this.cache.set(indexKey, [...hostIds, hostId]);
    }
  }
}
