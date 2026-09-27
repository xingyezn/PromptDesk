import { spawn } from 'node:child_process';

const environment = {
  ...process.env,
  VITE_BASE_PATH: '/',
};

function runNode(script, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      stdio: 'inherit',
      env: environment,
    });
    child.on('error', (error) => {
      console.error('Worker 前端构建启动失败。');
      console.error(error.message);
      resolve(1);
    });
    child.on('exit', (code, signal) => {
      resolve(signal ? 1 : (code ?? 1));
    });
  });
}

const typecheck = await runNode('node_modules/typescript/bin/tsc', ['--noEmit']);
if (typecheck !== 0) process.exit(typecheck);
const build = await runNode('node_modules/vite/bin/vite.js', ['build']);
process.exitCode = build;
