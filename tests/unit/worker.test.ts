import { describe, expect, it, vi } from 'vitest';
import { getApiHealth } from '../../src/services/api/client';
import { handleWorkerRequest, type WorkerEnvironment } from '../../worker/index';

function makeEnvironment(options: { version?: string; failDatabase?: boolean } = {}) {
  const assetsFetch = vi.fn(async () => new Response('app shell'));
  const first = vi.fn(async () => {
    if (options.failDatabase) throw new Error('private database diagnostic');
    return options.version ? { version: options.version } : null;
  });
  const prepare = vi.fn(() => ({ bind: vi.fn(() => ({ first })) }));
  const env = {
    ASSETS: { fetch: assetsFetch },
    DB: { prepare },
  } as unknown as WorkerEnvironment;
  return { env, assetsFetch, prepare, first };
}

describe('Worker public API boundary', () => {
  it('forwards non-API requests to static assets', async () => {
    const { env, assetsFetch } = makeEnvironment();
    const request = new Request('https://promptdesk.example/');
    const response = await handleWorkerRequest(request, env);
    expect(await response.text()).toBe('app shell');
    expect(assetsFetch).toHaveBeenCalledWith(request);
  });

  it('returns only health and schema versions without caching', async () => {
    const { env, prepare } = makeEnvironment({ version: '1' });
    const response = await handleWorkerRequest(
      new Request('https://promptdesk.example/api/health'),
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ ok: true, apiVersion: '1', schemaVersion: '1' });
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('hides database failure details and does not expose additional API routes', async () => {
    const { env } = makeEnvironment({ failDatabase: true });
    const unavailable = await handleWorkerRequest(
      new Request('https://promptdesk.example/api/health'),
      env,
    );
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).not.toContain('private database diagnostic');
    const missing = await handleWorkerRequest(
      new Request('https://promptdesk.example/api/accounts'),
      env,
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'NOT_FOUND' });
  });

  it('rejects methods outside the read-only contract', async () => {
    const { env, prepare } = makeEnvironment({ version: '1' });
    const response = await handleWorkerRequest(
      new Request('https://promptdesk.example/api/health', { method: 'POST', body: 'synthetic' }),
      env,
    );
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
    expect(prepare).not.toHaveBeenCalled();
  });

  it('disables email-only authentication routes without accessing auth services', async () => {
    const { env } = makeEnvironment();
    const response = await handleWorkerRequest(
      new Request('https://promptdesk.example/api/auth/request-password-reset', {
        method: 'POST',
        body: JSON.stringify({ email: 'synthetic@example.test' }),
      }),
      env,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'EMAIL_FEATURES_DISABLED' });
  });
});

describe('typed API client', () => {
  it('validates the health payload and uses the current origin', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ ok: true, apiVersion: '1', schemaVersion: '1' })),
    );
    const result = await getApiHealth(fetcher);
    expect(result).toEqual({
      ok: true,
      value: { ok: true, apiVersion: '1', schemaVersion: '1' },
    });
    expect(fetcher.mock.calls[0]?.[0]).toBeInstanceOf(URL);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'same-origin',
      cache: 'no-store',
    });
  });

  it('maps network and malformed responses to safe errors', async () => {
    const network = await getApiHealth(async () => {
      throw new Error('synthetic failure');
    });
    expect(network).toEqual({ ok: false, error: { code: 'NETWORK_UNAVAILABLE' } });

    const malformed = await getApiHealth(async () => new Response('{"unexpected":true}'));
    expect(malformed).toEqual({ ok: false, error: { code: 'INVALID_RESPONSE' } });
  });
});
