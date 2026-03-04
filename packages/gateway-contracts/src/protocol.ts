import { z } from 'zod';

export const TraceContextSchema = z.object({
  traceId: z.string(),
  spanId: z.string(),
  parentId: z.string().optional(),
});

// Host → Gateway: первое сообщение после подключения
export const HelloMessageSchema = z.object({
  type: z.literal('hello'),
  protocolVersion: z.string(),
  agentVersion: z.string(),
  hostId: z.string().optional(), // для reconnect
});

// Gateway → Host: подтверждение подключения
export const ConnectedMessageSchema = z.object({
  type: z.literal('connected'),
  protocolVersion: z.string(),
  hostId: z.string(),
  sessionId: z.string(),
});

// Gateway → Host: версия несовместима
export const NegotiateMessageSchema = z.object({
  type: z.literal('negotiate'),
  supportedVersions: z.array(z.string()),
});

// Gateway → Host: вызов адаптера
export const CallMessageSchema = z.object({
  type: z.literal('call'),
  requestId: z.string(),
  adapter: z.string(),
  method: z.string(),
  args: z.array(z.unknown()),
  bulk: z.boolean().optional(), // true → BulkRedirect
  trace: TraceContextSchema,
});

// Gateway → Host: redirect для bulk операций (большие файлы)
export const BulkRedirectMessageSchema = z.object({
  type: z.literal('bulk-redirect'),
  requestId: z.string(),
  uploadUrl: z.string(),
  expiresAt: z.number(),
});

// Host → Gateway: чанк данных (стриминг)
export const ChunkMessageSchema = z.object({
  type: z.literal('chunk'),
  requestId: z.string(),
  data: z.unknown(),
  index: z.number(),
});

// Host → Gateway: завершение вызова
export const ResultMessageSchema = z.object({
  type: z.literal('result'),
  requestId: z.string(),
  done: z.literal(true),
  trace: TraceContextSchema.optional(),
});

// Host → Gateway: ошибка при вызове
export const ErrorMessageSchema = z.object({
  type: z.literal('error'),
  requestId: z.string(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }),
});

// Host → Gateway: heartbeat
export const HeartbeatMessageSchema = z.object({
  type: z.literal('heartbeat'),
});

// Gateway → Host: ack heartbeat
export const AckMessageSchema = z.object({
  type: z.literal('ack'),
});

export const SUPPORTED_PROTOCOL_VERSIONS = ['1.0'] as const;

export type TraceContext = z.infer<typeof TraceContextSchema>;
export type HelloMessage = z.infer<typeof HelloMessageSchema>;
export type ConnectedMessage = z.infer<typeof ConnectedMessageSchema>;
export type NegotiateMessage = z.infer<typeof NegotiateMessageSchema>;
export type CallMessage = z.infer<typeof CallMessageSchema>;
export type BulkRedirectMessage = z.infer<typeof BulkRedirectMessageSchema>;
export type ChunkMessage = z.infer<typeof ChunkMessageSchema>;
export type ResultMessage = z.infer<typeof ResultMessageSchema>;
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;
export type HeartbeatMessage = z.infer<typeof HeartbeatMessageSchema>;
export type AckMessage = z.infer<typeof AckMessageSchema>;

export type InboundMessage = HelloMessage | HeartbeatMessage | ChunkMessage | ResultMessage | ErrorMessage;
export type OutboundMessage = ConnectedMessage | NegotiateMessage | CallMessage | BulkRedirectMessage | AckMessage;
