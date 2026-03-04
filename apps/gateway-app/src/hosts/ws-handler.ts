import { randomUUID } from 'node:crypto';
import type { WebSocket } from '@fastify/websocket';
import type { FastifyRequest } from 'fastify';
import type { ICache } from '@kb-labs/core-platform';
import {
  HelloMessageSchema,
  SUPPORTED_PROTOCOL_VERSIONS,
  type OutboundMessage,
} from '@kb-labs/gateway-contracts';
import { AdaptiveBuffer } from '@kb-labs/gateway-core';
import { HostRegistry } from './registry.js';
import { extractBearerToken, resolveToken } from '../auth/tokens.js';

const HELLO_TIMEOUT_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_GRACE_MS = 10_000;

function send(ws: WebSocket, msg: OutboundMessage): void {
  ws.send(JSON.stringify(msg));
}

export function createWsHandler(cache: ICache) {
  const registry = new HostRegistry(cache);
  const buffer = new AdaptiveBuffer(cache);

  return async function wsHandler(
    socket: WebSocket,
    request: FastifyRequest,
  ): Promise<void> {
    // 1. Auth — machine token required
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      socket.close(1008, 'Missing Authorization header');
      return;
    }

    const tokenEntry = await resolveToken(token, cache);
    if (!tokenEntry || tokenEntry.type !== 'machine') {
      socket.close(1008, 'Invalid machine token');
      return;
    }

    const { userId: hostId, namespaceId } = tokenEntry;
    const connectionId = randomUUID();
    const sessionId = randomUUID();

    // 2. Wait for hello (with timeout)
    let protocolVersion: string | null = null;
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

    // 3. Set online + send connected
    await registry.setOnline(hostId, namespaceId, connectionId);

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
            // TODO: route to pending call resolver (v2)
            break;
        }
      } catch {
        // ignore malformed messages
      }
    });

    // 7. Disconnect cleanup
    socket.on('close', async () => {
      clearInterval(heartbeatWatchdog);
      await registry.setOffline(hostId, namespaceId, connectionId);
    });
  };
}
