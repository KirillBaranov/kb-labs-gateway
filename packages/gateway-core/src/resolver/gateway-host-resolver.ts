/**
 * GatewayHostResolver — resolves ExecutionTarget to a hostId via Gateway REST API.
 *
 * Implements IHostResolver from core-contracts.
 * This is the only place that knows about Gateway HTTP — execution layer
 * only sees the IHostResolver interface.
 */

import type { IHostResolver, HostResolution, ExecutionTarget } from '@kb-labs/core-contracts';

export interface GatewayHostResolverOptions {
  /** Gateway base URL (e.g., http://localhost:4000) */
  gatewayUrl: string;
  /** Internal secret for Gateway auth */
  internalSecret: string;
  /** Request timeout in ms (default: 5000) */
  timeoutMs?: number;
}

export class GatewayHostResolver implements IHostResolver {
  private readonly url: string;
  private readonly secret: string;
  private readonly timeoutMs: number;

  constructor(options: GatewayHostResolverOptions) {
    this.url = `${options.gatewayUrl.replace(/\/$/, '')}/internal/resolve-host`;
    this.secret = options.internalSecret;
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  async resolve(target: ExecutionTarget): Promise<HostResolution | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': this.secret,
        },
        body: JSON.stringify({
          namespaceId: target.namespace ?? 'default',
          target,
        }),
        signal: controller.signal,
      });

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        return null;
      }

      const body = await response.json() as { hostId: string; strategy: string; namespaceId: string };
      return {
        hostId: body.hostId,
        strategy: (body.strategy ?? 'any-matching') as HostResolution['strategy'],
        namespaceId: body.namespaceId,
      };
    } catch {
      // Network error, timeout — treat as no host available
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
