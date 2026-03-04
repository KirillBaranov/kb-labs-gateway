import { z } from 'zod';

export const UpstreamConfigSchema = z.object({
  url: z.string().url(),
  prefix: z.string().startsWith('/'),
  description: z.string().optional(),
});

export const StaticTokenEntrySchema = z.object({
  hostId: z.string(),
  namespaceId: z.string(),
});

export const GatewayConfigSchema = z.object({
  port: z.number().default(4000),
  upstreams: z.record(z.string(), UpstreamConfigSchema).default({}),
  /** Static tokens seeded into ICache at bootstrap — for dev/service tokens before full auth */
  staticTokens: z.record(z.string(), StaticTokenEntrySchema).default({}),
});

export type UpstreamConfig = z.infer<typeof UpstreamConfigSchema>;
export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;
