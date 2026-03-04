import {
  initPlatform,
  platform,
  type PlatformLifecycleContext,
  type PlatformLifecycleHooks,
  type PlatformLifecyclePhase,
} from '@kb-labs/core-runtime';
import { findNearestConfig, readJsonWithDiagnostics } from '@kb-labs/core-config';
import type { PlatformConfig } from '@kb-labs/core-runtime';
import path from 'node:path';

let _initialized = false;
const GATEWAY_LIFECYCLE_HOOK_ID = 'gateway';
let _hooksRegistered = false;

function resolvePlatformRootFromConfigPath(configPath: string): string {
  const configDir = path.dirname(configPath);
  if (path.basename(configDir) === '.kb') {
    return path.dirname(configDir);
  }
  return configDir;
}

function ensureLifecycleHooksRegistered(): void {
  if (_hooksRegistered) {return;}

  const hooks: PlatformLifecycleHooks = {
    onStart: (ctx: PlatformLifecycleContext) => {
      console.log('[gateway:platform] lifecycle:start', { cwd: ctx.cwd });
    },
    onReady: (ctx: PlatformLifecycleContext) => {
      platform.logger.info('Platform lifecycle ready', {
        app: 'gateway',
        durationMs: ctx.metadata?.durationMs,
      });
    },
    onShutdown: () => {
      platform.logger.info('Platform lifecycle shutdown', { app: 'gateway' });
    },
    onError: (error: unknown, phase: PlatformLifecyclePhase) => {
      console.warn('[gateway:platform] lifecycle:error', {
        phase,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  };

  platform.registerLifecycleHooks(GATEWAY_LIFECYCLE_HOOK_ID, hooks);
  _hooksRegistered = true;
}

export async function initializePlatform(cwd: string = process.cwd()): Promise<void> {
  ensureLifecycleHooksRegistered();

  if (_initialized) {
    console.log('[gateway:platform] Already initialized, skipping');
    return;
  }

  try {
    const { path: configPath } = await findNearestConfig({
      startDir: cwd,
      filenames: ['.kb/kb.config.json', 'kb.config.json'],
    });

    if (!configPath) {
      console.log('[gateway:platform] No kb.config.json found, using NoOp adapters');
      await initPlatform({ adapters: {} }, cwd);
      _initialized = true;
      return;
    }

    const result = await readJsonWithDiagnostics<{ platform?: PlatformConfig }>(configPath);
    const platformRoot = resolvePlatformRootFromConfigPath(configPath);

    if (!result.ok) {
      console.warn('[gateway:platform] Failed to read kb.config.json, using NoOp adapters');
      await initPlatform({ adapters: {} }, cwd);
      _initialized = true;
      return;
    }

    const platformConfig = result.data.platform;
    if (!platformConfig) {
      console.log('[gateway:platform] No platform config, using NoOp adapters');
      await initPlatform({ adapters: {} }, cwd);
      _initialized = true;
      return;
    }

    await initPlatform(platformConfig, platformRoot);
    _initialized = true;

    platform.logger.info('Platform adapters initialized', {
      adapters: Object.keys(platformConfig.adapters ?? {}),
      platformRoot,
    });
  } catch (error) {
    console.warn('[gateway:platform] Initialization failed, using NoOp adapters', {
      error: error instanceof Error ? error.message : String(error),
    });
    await initPlatform({ adapters: {} }, cwd);
    _initialized = true;
  }
}
