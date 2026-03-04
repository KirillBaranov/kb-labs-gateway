import type { ICache } from '@kb-labs/core-platform';
import type { AuthContext } from '@kb-labs/gateway-contracts';

/**
 * Resolve a Bearer token to an AuthContext.
 * v1: machine tokens only (stored in ICache by HostRegistry).
 * User/CLI tokens return a placeholder — auth will be expanded in v2.
 */
export async function resolveToken(
  token: string,
  cache: ICache,
): Promise<AuthContext | null> {
  // Try machine token first (Host Agent)
  const machineEntry = await cache.get<{ hostId: string; namespaceId: string }>(
    `host:token:${token}`,
  );

  if (machineEntry) {
    return {
      type: 'machine',
      userId: machineEntry.hostId,
      namespaceId: machineEntry.namespaceId,
      tier: 'free',
      permissions: ['host:connect'],
    };
  }

  // Unknown token — reject. CLI/user tokens require explicit registration (v2).
  return null;
}

export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) {return null;}
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? (match[1] ?? null) : null;
}
