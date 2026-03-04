import { bootstrap } from './bootstrap.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';

async function findMonorepoRoot(startDir: string): Promise<string> {
  let dir = path.resolve(startDir);

  while (true) {
    try {
      const workspacePath = path.join(dir, 'pnpm-workspace.yaml');
      await fs.access(workspacePath);
      const content = await fs.readFile(workspacePath, 'utf-8');
      if (content.includes('kb-*')) {
        return dir;
      }
    } catch {
      // continue
    }

    const parent = path.dirname(dir);
    if (parent === dir) {break;}
    dir = parent;
  }

  return process.cwd();
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const startDir = path.resolve(currentDir, '..', '..', '..');

findMonorepoRoot(startDir).then((repoRoot) => {
  bootstrap(repoRoot).catch((error) => {
    console.error('Failed to start gateway:', error);
    process.exit(1);
  });
}).catch((error) => {
  console.error('Failed to find monorepo root:', error);
  process.exit(1);
});
