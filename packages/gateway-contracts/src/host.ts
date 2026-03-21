import { z } from 'zod';
import { WorkspaceInfoSchema, PluginInfoSchema } from './protocol.js';

export const HostCapabilitySchema = z.enum(['filesystem', 'git', 'editor-context', 'execution']);

export const HostTypeSchema = z.enum(['local', 'cloud']);

export const HostRegistrationSchema = z.object({
  name: z.string(),
  namespaceId: z.string(),
  capabilities: z.array(HostCapabilitySchema),
  workspacePaths: z.array(z.string()),
  hostType: HostTypeSchema.optional(),
});

export const HostDescriptorSchema = z.object({
  hostId: z.string(),
  name: z.string(),
  namespaceId: z.string(),
  capabilities: z.array(HostCapabilitySchema),
  status: z.enum(['online', 'offline', 'degraded']),
  lastSeen: z.number(),
  connections: z.array(z.string()),
  // Workspace Agent metadata (populated from hello message)
  hostType: HostTypeSchema.optional(),
  workspaces: z.array(WorkspaceInfoSchema).optional(),
  plugins: z.array(PluginInfoSchema).optional(),
});

export const HostRegisterResponseSchema = z.object({
  hostId: z.string(),
  machineToken: z.string(),
  status: z.enum(['online', 'offline', 'degraded']),
});

export type HostCapability = z.infer<typeof HostCapabilitySchema>;
export type HostType = z.infer<typeof HostTypeSchema>;
export type HostRegistration = z.infer<typeof HostRegistrationSchema>;
export type HostDescriptor = z.infer<typeof HostDescriptorSchema>;
export type HostRegisterResponse = z.infer<typeof HostRegisterResponseSchema>;
