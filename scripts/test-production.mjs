import { spawnSync } from 'node:child_process';
import process from 'node:process';
const env = {
  ...process.env,
  VITE_BASE_PATH: process.env.VITE_BASE_PATH || '/PromptDesk/',
  PROMPTDESK_PRODUCTION: '1',
};
for (const args of [
  ['node_modules/vite/bin/vite.js', 'build'],
  ['node_modules/@playwright/test/cli.js', 'test', '--grep-invert', '1000 synthetic'],
]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env });
  if (result.error || result.status !== 0) process.exit(result.status ?? 1);
}
