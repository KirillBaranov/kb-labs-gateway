import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';

interface WsRequest {
  headers: { authorization?: string };
  url?: string;
}
import type { ICache } from '@kb-labs/core-platform';
import {
  HelloMessageSchema,
  HostCapabilitySchema,
  SUPPORTED_PROTOCOL_VERSIONS,
  type OutboundMessage,
} from '@kb-labs/gateway-contracts';
import { AdaptiveBuffer } from '@kb-labs/gateway-core';
import { getClientByHostId, type JwtConfig } from '@kb-labs/gateway-auth';
import { HostRegistry } from './registry.js';
import { extractBearerToken, resolveToken } from '../auth/tokens.js';
import { globalDispatcher } from './dispatcher.js';
import { executionRegistry } from '../execute/execution-registry.js';

const HELLO_TIMEOUT_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_GRACE_MS = 10_000;

function send(ws: WebSocket, msg: OutboundMessage): void {
  ws.send(JSON.stringify(msg));
}

export function createWsHandler(cache: ICache, jwtConfig: JwtConfig) {
  const registry = new HostRegistry(cache);
  const buffer = new AdaptiveBuffer(cache);

  return async function wsHandler(
    socket: WebSocket,
    request: WsRequest,
  ): Promise<void> {
    // 1. Auth — machine token required
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      socket.close(1008, 'Missing Authorization header');
      return;
    }

    const tokenEntry = await resolveToken(token, cache, jwtConfig);
    if (!tokenEntry || tokenEntry.type !== 'machine') {
      socket.close(1008, 'Invalid machine token');
      return;
    }

    const { userId: hostId, namespaceId } = tokenEntry;
    const connectionId = randomUUID();
    const sessionId = randomUUID();

    // 2. Wait for hello (with timeout)
    let protocolVersion: string | null = null;
    let helloCaps: string[] = [];
    let helloDone = false;

    const protocolVersions: readonly string[] = SUPPORTED_PROTOCOL_VERSIONS;

    await new Promise<void>((resolve, reject) => {
      const helloTimeout = setTimeout(() => {
        if (!helloDone) {
          helloDone = true;
          socket.close(1008, 'Hello timeout');
          reject(new Error('Hello timeout'));
        }
      }, HELLO_TIMEOUT_MS);

      socket.once('message', (raw) => {
        if (helloDone) {return;}
        helloDone = true;
        clearTimeout(helloTimeout);

        try {
          const msg = HelloMessageSchema.parse(JSON.parse(raw.toString()));

          // Version negotiation
          if (!protocolVersions.includes(msg.protocolVersion)) {
            send(socket, {
              type: 'negotiate',
              supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
            });
            socket.close(1008, 'Unsupported protocol version');
            reject(new Error('Unsupported protocol version'));
            return;
          }

          protocolVersion = msg.protocolVersion;
          helloCaps = msg.capabilities ?? [];
          resolve();
        } catch {
          socket.close(1008, 'Invalid hello message');
          reject(new Error('Invalid hello'));
        }
      });
    }).catch(() => {
      // socket already closed — errors logged above
    });

    if (!protocolVersion) {return;}

    // 3. Ensure host descriptor exists (JWT-registered hosts have no registry entry yet)
    const clientRecord = await getClientByHostId(cache, hostId);
    const registryCaps = (clientRecord?.capabilities ?? [])
      .map((c) => HostCapabilitySchema.safeParse(c))
      .filter((r) => r.success)
      .map((r) => r.data);

    // Security: for JWT-registered hosts use capabilities from clientRecord only.
    // For static-token hosts (no clientRecord) accept capabilities from hello message,
    // but validate each against HostCapabilitySchema to reject unknown values.
    const validatedHelloCaps = clientRecord ? [] : helloCaps
      .map((c) => HostCapabilitySchema.safeParse(c))
      .filter((r) => r.success)
      .map((r) => r.data);

    const capabilities = clientRecord ? registryCaps : validatedHelloCaps;
    await registry.ensureRegistered(hostId, namespaceId, clientRecord?.name ?? hostId, capabilities);

    // 4. Set online + register in dispatcher (with capabilities for routing) + send connected
    await registry.setOnline(hostId, namespaceId, connectionId);
    globalDispatcher.registerConnection(hostId, namespaceId, socket, capabilities);

    send(socket, {
      type: 'connected',
      protocolVersion,
      hostId,
      sessionId,
    });

    // 4. Flush buffered calls
    const buffered = await buffer.flush(hostId);
    for (const call of buffered) {
      send(socket, {
        type: 'call',
        requestId: call.requestId,
        adapter: call.adapter,
        method: call.method,
        args: call.args,
        trace: { traceId: call.requestId, spanId: randomUUID() },
      });
    }

    // 5. Heartbeat watchdog
    let lastHeartbeat = Date.now();
    const heartbeatWatchdog = setInterval(async () => {
      const elapsed = Date.now() - lastHeartbeat;
      if (elapsed > HEARTBEAT_INTERVAL_MS + HEARTBEAT_GRACE_MS) {
        // Mark as degraded (don't close — allow recovery)
        const host = await registry.get(hostId, namespaceId);
        if (host && host.status !== 'degraded') {
          await cache.set(`host:registry:${namespaceId}:${hostId}`, {
            ...host,
            status: 'degraded',
          });
        }
      }
    }, HEARTBEAT_INTERVAL_MS);

    // 6. Message handler
    socket.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; requestId?: string };

        switch (msg.type) {
          case 'heartbeat':
            lastHeartbeat = Date.now();
            await registry.heartbeat(hostId, namespaceId);
            send(socket, { type: 'ack' });
            break;

          case 'chunk':
          case 'result':
          case 'error':
            globalDispatcher.handleInbound(msg as { type: string; requestId?: string; data?: unknown; error?: unknown });
            break;
        }
      } catch {
        // ignore malformed messages
      }
    });

    // 7. Disconnect cleanup
    socket.on('close', async () => {
      clearInterval(heartbeatWatchdog);
      globalDispatcher.removeConnection(hostId, namespaceId);

      // Cancel all executions dispatched to this host (CC2)
      const cancelled = executionRegistry.cancelByHost(hostId, 'disconnect');
      if (cancelled.length > 0) {
        console.warn(`[ws-handler] Host ${hostId} disconnected, cancelled ${cancelled.length} execution(s)`);
      }

      await registry.setOffline(hostId, namespaceId, connectionId);
    });
  };
}
