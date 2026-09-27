import { randomBytes, randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';

const environment = process.argv[2];
const destination = process.argv[3];
if (!['preview', 'production', 'test'].includes(environment) || !destination) {
  console.error(
    'Usage: node scripts/bootstrap-admin.mjs <preview|production|test> <private-credentials-file>',
  );
  process.exit(1);
}
const cli = './node_modules/wrangler/bin/wrangler.js';
const scope = environment === 'test' ? '--local' : '--remote';
function execute(args) {
  const result = spawnSync(
    process.execPath,
    [cli, 'd1', 'execute', 'DB', '--env', environment, scope, '--json', ...args],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error('ADMIN_INITIALIZATION_FAILED');
  // Remote SQL-file execution may include upload progress even with --json.
  // Mutation receipts are verified by a separate bounded read, without logging SQL or hashes.
  return args.includes('--file') ? null : JSON.parse(result.stdout);
}
const existing = execute(['--command', "SELECT COUNT(*) AS n FROM user_access WHERE role='admin'"]);
if (existing[0]?.results?.[0]?.n > 0) {
  console.log('An administrator already exists; no credentials were changed.');
  process.exit(0);
}
const password =
  environment === 'test'
    ? 'Synthetic-local-admin-password-12'
    : randomBytes(24).toString('base64url');
const id = randomUUID(),
  accountId = randomUUID(),
  now = new Date().toISOString();
const hashed = await hashPassword(password);
const sqlPath = join(tmpdir(), `promptdesk-admin-${randomUUID()}.sql`);
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const credentialPath = resolve(destination);
const repoRelative = relative(process.cwd(), credentialPath);
if (environment !== 'test' && !repoRelative.startsWith('..') && !isAbsolute(repoRelative)) {
  console.error('Production credentials must be saved outside the repository.');
  process.exit(1);
}
await mkdir(dirname(credentialPath), { recursive: true });
// This file is outside the repository for production. No password is emitted to stdout or CLI arguments.
await writeFile(
  credentialPath,
  `PromptDesk ${environment} administrator\nLogin: admin@promptdesk.local\nInitial password: ${password}\nChange this password immediately after signing in.\n`,
  { flag: 'wx', mode: 0o600 },
);
try {
  await writeFile(
    sqlPath,
    `INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(${quote(id)},'管理员','admin@promptdesk.local',0,${quote(now)},${quote(now)});
INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES(${quote(accountId)},${quote(id)},'credential',${quote(id)},${quote(hashed)},${quote(now)},${quote(now)});
UPDATE user_access SET role='admin',mustChangePassword=1 WHERE userId=${quote(id)} AND EXISTS(SELECT 1 FROM account WHERE userId=${quote(id)} AND providerId='credential');`,
    { mode: 0o600 },
  );
  execute(['--file', sqlPath]);
  const verified = execute([
    '--command',
    `SELECT COUNT(*) AS n FROM user_access WHERE userId=${quote(id)} AND role='admin' AND mustChangePassword=1`,
  ]);
  if (verified[0]?.results?.[0]?.n !== 1) throw new Error('ADMIN_INITIALIZATION_FAILED');
  console.log(
    'Administrator initialized. Credentials saved privately; first sign-in requires a password change.',
  );
} catch {
  console.error(
    'Administrator initialization failed. Preserve the private credentials file and inspect configuration; no automatic overwrite was attempted.',
  );
  process.exitCode = 1;
} finally {
  await rm(sqlPath, { force: true });
}
