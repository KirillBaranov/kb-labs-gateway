import { describe, it, expect, vi } from 'vitest';
import { resolveToken, extractBearerToken } from '../auth/tokens.js';
import type { ICache } from '@kb-labs/core-platform';

function makeCache(entries: Record<string, unknown> = {}): ICache {
  return {
    get: vi.fn(async (key: string) => entries[key] ?? null),
    set: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
  } as unknown as ICache;
}

describe('extractBearerToken', () => {
  it('extracts token from Bearer header', () => {
    expect(extractBearerToken('Bearer abc-123')).toBe('abc-123');
  });

  it('is case-insensitive', () => {
    expect(extractBearerToken('bearer abc-123')).toBe('abc-123');
    expect(extractBearerToken('BEARER abc-123')).toBe('abc-123');
  });

  it('returns null for missing header', () => {
    expect(extractBearerToken(undefined)).toBeNull();
  });

  it('returns null for non-Bearer scheme', () => {
    expect(extractBearerToken('Basic dXNlcjpwYXNz')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractBearerToken('')).toBeNull();
  });

  it('handles token with special characters', () => {
    expect(extractBearerToken('Bearer 8d006616-9c5e-466f-a72f-1c6a6dc20a60')).toBe(
      '8d006616-9c5e-466f-a72f-1c6a6dc20a60',
    );
  });
});

describe('resolveToken', () => {
  it('resolves machine token from cache', async () => {
    const token = 'machine-token-uuid';
    const cache = makeCache({
      [`host:token:${token}`]: { hostId: 'host-1', namespaceId: 'ns-1' },
    });

    const ctx = await resolveToken(token, cache);
    expect(ctx).not.toBeNull();
    expect(ctx!.type).toBe('machine');
    expect(ctx!.userId).toBe('host-1');
    expect(ctx!.namespaceId).toBe('ns-1');
    expect(ctx!.permissions).toContain('host:connect');
  });

  it('returns null for unknown token (no CLI fallback)', async () => {
    const cache = makeCache(); // no entries
    const ctx = await resolveToken('some-unknown-token', cache);
    expect(ctx).toBeNull();
  });

  it('machine token resolves correctly, unknown token returns null', async () => {
    const token = 'machine-uuid';
    const cache = makeCache({ [`host:token:${token}`]: { hostId: 'h-1', namespaceId: 'ns-a' } });
    const ctx = await resolveToken(token, cache);
    expect(ctx!.type).toBe('machine');

    const unknown = await resolveToken('other-token', cache);
    expect(unknown).toBeNull();
  });

  it('checks correct cache key for machine token', async () => {
    const token = 'test-token';
    const cache = makeCache();
    await resolveToken(token, cache);
    expect(cache.get).toHaveBeenCalledWith(`host:token:${token}`);
  });
});
