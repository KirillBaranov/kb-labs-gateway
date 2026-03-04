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

    return { descriptor, machineToken };
  }

  async setOnline(hostId: string, namespaceId: string, connectionId: string): Promise<void> {
    const key = `host:registry:${namespaceId}:${hostId}`;
    const host = await this.cache.get<HostDescriptor>(key);
    if (!host) {return;}
    const connections = [...new Set([...host.connections, connectionId])];
    await this.cache.set(key, { ...host, status: 'online', lastSeen: Date.now(), connections });
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
}
