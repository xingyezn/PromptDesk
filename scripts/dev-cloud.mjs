import { spawnSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
const cli = './node_modules/wrangler/bin/wrangler.js';
const run = (file, args) => {
  const result = spawnSync(process.execPath, [file, ...args], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
run('./scripts/build-worker.mjs', []);
run(cli, ['d1', 'migrations', 'apply', 'promptdesk-test-db', '--local', '--env', 'test']);
run(cli, [
  'd1',
  'execute',
  'DB',
  '--env',
  'test',
  '--local',
  '--command',
  "DELETE FROM user WHERE email LIKE '%@example.test' OR email='admin@promptdesk.local'; DELETE FROM rateLimit;",
]);
mkdirSync('work', { recursive: true });
rmSync('work/test-admin.txt', { force: true });
run('./scripts/bootstrap-admin.mjs', ['test', 'work/test-admin.txt']);
const server = spawn(
  process.execPath,
  [cli, 'dev', '--env', 'test', '--local', '--ip', '127.0.0.1', '--port', '8789'],
  { stdio: 'inherit' },
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    server.kill(signal);
    process.exit();
  });
server.on('exit', (code) => process.exit(code ?? 0));
