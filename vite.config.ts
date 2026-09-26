import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const base = loadEnv(mode, process.cwd(), '').VITE_BASE_PATH || '/';
  if (!/^\/(?:[A-Za-z0-9._-]+\/)?$/.test(base)) throw new Error('Invalid base path');
  return {
    base,
    plugins: [
      react(),
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
                  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'",
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
