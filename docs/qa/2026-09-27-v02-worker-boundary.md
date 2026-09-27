# V0.2-03 Worker service boundary verification

Date: 2026-09-27  
Scope: local Worker + D1 architecture spike. No Cloudflare account or remote environment was used.

## Result

- GitHub Pages remains the `/PromptDesk/` static preview. A separate Worker origin serves the same React SPA at `/` and the `/api/*` namespace, so a future account session can remain same-origin on the Worker deployment.
- The only implemented API is read-only `GET /api/health`. It returns API/schema version only. `worker/migrations/0001_service_meta.sql` contains no account, Prompt, Workspace, path, or provider-key data.
- Wrangler serves `dist/` through the Assets binding. The Worker build rewrites the PWA manifest to root scope; the Pages build continues to use the repository subpath.
- `src/services/api/client.ts` is the UI-side typed boundary. No React component calls D1 or a third-party model. Service Worker bypasses `/api` requests.

## Evidence

Using Node 22.20.0 and fixed Wrangler 4.141.0:

- `npm run worker:migrations:local`: applied `0001_service_meta.sql` to local D1.
- `npm run worker:dev`: Wrangler reported local D1 and Assets bindings, ready at `http://127.0.0.1:8787`.
- Synthetic HTTP smoke: `GET /api/health` returned `200` and `{"ok":true,"apiVersion":"1","schemaVersion":"1"}`; `/` and `/capture` returned `200`; `/api/accounts` returned `404`.
- `npx wrangler deploy --dry-run --env=` read 12 static assets, compiled the Worker, and reported D1/Assets bindings without credentials.
- Explicit `--env=preview` and `--env=production` dry-runs both loaded their distinct named D1 bindings and the same static assets; IDs remain placeholders and nothing was uploaded.
- Unit tests cover static forwarding, health response, no-store header, database error detail suppression, unknown API paths, rejected methods, same-origin client configuration, malformed API responses, and network failure.
- `npm run test:e2e:production`: 10 passed, including existing Pages subpath manifest/service-worker behavior.

## Checks

`npm run format:check`, `npm run typecheck`, `npm run lint`, and `npm run test` passed (75 tests). `npm run worker:check` passed its root-base build and Wrangler dry-runs for default, preview, and production configuration. `npm run test:e2e:production` passed (10 tests). The generated Worker manifest was verified to use `scope: "/"` and `start_url: "/#/capture"` while the Pages production E2E still verified its `/PromptDesk/` scope.

## Not verified / remaining

- No Worker was deployed to Cloudflare; no DNS/domain, preview/production D1 IDs, secrets, or rollback were configured. The all-zero D1 ID in `wrangler.jsonc` is local-only and must be replaced before deployment.
- No accounts, cookies, business writes, third-party calls, request payload handling, provider keys, or user data exist in this stage. Body caps, route timeouts and rate limits must be specified before introducing mutating/paid endpoints.
- PWA installation on physical iOS/Android devices and native Workspace permissions remain separate manual acceptance items.
