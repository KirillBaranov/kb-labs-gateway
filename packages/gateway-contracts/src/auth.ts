import { z } from 'zod';

export const TokenTypeSchema = z.enum(['user', 'cli', 'machine']);

export const AuthContextSchema = z.object({
  type: TokenTypeSchema,
  userId: z.string(),
  namespaceId: z.string(),
  tier: z.enum(['free', 'pro', 'enterprise']),
  permissions: z.array(z.string()),
});

export type TokenType = z.infer<typeof TokenTypeSchema>;
export type AuthContext = z.infer<typeof AuthContextSchema>;
