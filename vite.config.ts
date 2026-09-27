import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

function offlineShellPlugin(base: string) {
  return {
    name: 'promptdesk-offline-shell',
    apply: 'build' as const,
    enforce: 'post' as const,
    async writeBundle(options: { dir?: string }, bundle: Record<string, unknown>) {
      if (!options.dir) throw new Error('PWA output requires a directory build');
      const files = [
        ...Object.keys(bundle).filter(
          (file) => file !== 'sw.js' && /\.(?:html|js|css|svg|png|webmanifest)$/.test(file),
        ),
        'manifest.webmanifest',
        'promptdesk.svg',
        'icons/promptdesk-192.png',
        'icons/promptdesk-512.png',
      ];
      const versionHash = createHash('sha256').update(files.sort().join('\n'));
      for (const file of [
        'manifest.webmanifest',
        'promptdesk.svg',
        ...files.filter((path) => path.startsWith('icons/')),
      ])
        versionHash.update(await readFile(resolve(process.cwd(), 'public', file)));
      const version = versionHash.digest('hex').slice(0, 12);
      const staticPaths = JSON.stringify(files);
      const manifestPath = resolve(options.dir, 'manifest.webmanifest');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
      manifest.scope = base;
      manifest.start_url = `${base}#/`;
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
      const worker = `const CACHE_NAME = 'promptdesk-shell-${version}';
const STATIC_PATHS = new Set(${staticPaths});
const SCOPE_URL = new URL('./', self.location.href);
const SHELL_URL = SCOPE_URL.href;
const API_PATH = new URL('api/', SCOPE_URL).pathname;
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll([SHELL_URL, ...[...STATIC_PATHS].map((path) => new URL(path, SCOPE_URL).href)])));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then(async (keys) => {
    await Promise.all(keys.filter((key) => key.startsWith('promptdesk-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  }));
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.search || !url.pathname.startsWith(SCOPE_URL.pathname)) return;
  if (url.pathname === API_PATH.slice(0, -1) || url.pathname.startsWith(API_PATH)) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.open(CACHE_NAME).then((cache) => cache.match(SHELL_URL, { ignoreVary: true }))));
    return;
  }
  const path = url.pathname.slice(SCOPE_URL.pathname.length);
  if (!STATIC_PATHS.has(path)) return;
  event.respondWith(caches.open(CACHE_NAME).then(async (cache) => {
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  }));
});
self.addEventListener('message', (event) => {
  if (event.data === 'ACTIVATE_UPDATE') void self.skipWaiting();
});`;
      await writeFile(resolve(options.dir, 'sw.js'), worker, 'utf8');
    },
  };
}

export default defineConfig(({ mode }) => {
  const base = loadEnv(mode, process.cwd(), '').VITE_BASE_PATH || '/';
  if (!/^\/(?:[A-Za-z0-9._-]+\/)?$/.test(base)) throw new Error('Invalid base path');
  return {
    base,
    plugins: [
      react(),
      offlineShellPlugin(base),
      {
        name: 'production-privacy-policy',
        apply: 'build',
        transformIndexHtml() {
          return [
            {
              tag: 'meta',
              attrs: {
                'http-equiv': 'Content-Security-Policy',
                content:
                  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'",
              },
              injectTo: 'head-prepend',
            },
          ];
        },
      },
    ],
    build: { target: 'es2022' },
    server: { port: 5173, strictPort: true },
  };
});
