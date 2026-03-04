import { z } from 'zod';

export const HostCapabilitySchema = z.enum(['filesystem', 'git', 'editor-context']);

export const HostRegistrationSchema = z.object({
  name: z.string(),
  namespaceId: z.string(),
  capabilities: z.array(HostCapabilitySchema),
  workspacePaths: z.array(z.string()),
});

export const HostDescriptorSchema = z.object({
  hostId: z.string(),
  name: z.string(),
  namespaceId: z.string(),
  capabilities: z.array(HostCapabilitySchema),
  status: z.enum(['online', 'offline', 'degraded']),
  lastSeen: z.number(),
  connections: z.array(z.string()),
});

export const HostRegisterResponseSchema = z.object({
  hostId: z.string(),
  machineToken: z.string(),
  status: z.enum(['online', 'offline', 'degraded']),
});

export type HostCapability = z.infer<typeof HostCapabilitySchema>;
export type HostRegistration = z.infer<typeof HostRegistrationSchema>;
export type HostDescriptor = z.infer<typeof HostDescriptorSchema>;
export type HostRegisterResponse = z.infer<typeof HostRegisterResponseSchema>;
