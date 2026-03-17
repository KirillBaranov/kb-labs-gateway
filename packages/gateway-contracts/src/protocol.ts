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
  capabilities: z.array(z.string()).optional(), // адаптеры которые умеет этот хост
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

// ── Execution event schemas (CC1 — Streaming) ──

// Execution output event (stdout/stderr from handler)
export const ExecutionOutputSchema = z.object({
  type: z.literal('execution:output'),
  requestId: z.string(),
  executionId: z.string(),
  stream: z.enum(['stdout', 'stderr']),
  data: z.string(),
  timestamp: z.number(),
});

// Execution progress event
export const ExecutionProgressSchema = z.object({
  type: z.literal('execution:progress'),
  requestId: z.string(),
  executionId: z.string(),
  step: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  label: z.string(),
  timestamp: z.number(),
});

// Execution artifact event (file created during execution)
export const ExecutionArtifactSchema = z.object({
  type: z.literal('execution:artifact'),
  requestId: z.string(),
  executionId: z.string(),
  name: z.string(),
  mime: z.string(),
  url: z.string(),
  sizeBytes: z.number().optional(),
});

// Execution error event
export const ExecutionErrorEventSchema = z.object({
  type: z.literal('execution:error'),
  requestId: z.string(),
  executionId: z.string(),
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
  attempt: z.number().int().optional(),
  maxAttempts: z.number().int().optional(),
});

// Execution done event (final — execution completed)
export const ExecutionDoneSchema = z.object({
  type: z.literal('execution:done'),
  requestId: z.string(),
  executionId: z.string(),
  exitCode: z.number().int(),
  durationMs: z.number().int().nonnegative(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// Execution retry event (between attempts — CC3)
export const ExecutionRetrySchema = z.object({
  type: z.literal('execution:retry'),
  requestId: z.string(),
  executionId: z.string(),
  attempt: z.number().int().positive(),
  maxAttempts: z.number().int().positive(),
  delayMs: z.number().nonnegative(),
  error: z.string(),
});

// Execution cancelled event
export const ExecutionCancelledSchema = z.object({
  type: z.literal('execution:cancelled'),
  requestId: z.string(),
  executionId: z.string(),
  reason: z.enum(['user', 'timeout', 'disconnect', 'system']),
  durationMs: z.number().int().nonnegative(),
});

// Cancel message: client → Gateway
export const CancelMessageSchema = z.object({
  type: z.literal('cancel'),
  requestId: z.string(),
  reason: z.enum(['user', 'timeout', 'disconnect']).optional(),
});

// Subscribe message: client → Gateway (multi-client pub/sub, CC5)
export const SubscribeMessageSchema = z.object({
  type: z.literal('subscribe'),
  executionId: z.string(),
});

// Unsubscribe message: client → Gateway
export const UnsubscribeMessageSchema = z.object({
  type: z.literal('unsubscribe'),
  executionId: z.string(),
});

// ── Execute request schema (for POST /api/v1/execute) ──

export const ExecuteRequestSchema = z.object({
  pluginId: z.string(),
  handlerRef: z.string(),
  exportName: z.string().optional(),
  input: z.unknown(),
  timeoutMs: z.number().int().positive().optional(),
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
export type ExecutionOutputMessage = z.infer<typeof ExecutionOutputSchema>;
export type ExecutionProgressMessage = z.infer<typeof ExecutionProgressSchema>;
export type ExecutionArtifactMessage = z.infer<typeof ExecutionArtifactSchema>;
export type ExecutionErrorEventMessage = z.infer<typeof ExecutionErrorEventSchema>;
export type ExecutionDoneMessage = z.infer<typeof ExecutionDoneSchema>;
export type ExecutionRetryMessage = z.infer<typeof ExecutionRetrySchema>;
export type ExecutionCancelledMessage = z.infer<typeof ExecutionCancelledSchema>;
export type CancelMessage = z.infer<typeof CancelMessageSchema>;
export type SubscribeMessage = z.infer<typeof SubscribeMessageSchema>;
export type UnsubscribeMessage = z.infer<typeof UnsubscribeMessageSchema>;
export type ExecuteRequest = z.infer<typeof ExecuteRequestSchema>;

export type ExecutionEventMessage =
  | ExecutionOutputMessage
  | ExecutionProgressMessage
  | ExecutionArtifactMessage
  | ExecutionErrorEventMessage
  | ExecutionDoneMessage
  | ExecutionRetryMessage
  | ExecutionCancelledMessage;

export type InboundMessage =
  | HelloMessage
  | HeartbeatMessage
  | ChunkMessage
  | ResultMessage
  | ErrorMessage
  | CancelMessage
  | SubscribeMessage
  | UnsubscribeMessage;

export type OutboundMessage =
  | ConnectedMessage
  | NegotiateMessage
  | CallMessage
  | BulkRedirectMessage
  | AckMessage
  | ExecutionOutputMessage
  | ExecutionProgressMessage
  | ExecutionArtifactMessage
  | ExecutionErrorEventMessage
  | ExecutionDoneMessage;
