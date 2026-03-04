import { z } from 'zod';

export const UpstreamConfigSchema = z.object({
  url: z.string().url(),
  prefix: z.string().startsWith('/'),
  description: z.string().optional(),
});

export const GatewayConfigSchema = z.object({
  port: z.number().default(4000),
  upstreams: z.record(z.string(), UpstreamConfigSchema).default({}),
});

export type UpstreamConfig = z.infer<typeof UpstreamConfigSchema>;
export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;
