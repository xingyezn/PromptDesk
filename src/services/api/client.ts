export interface ApiHealth {
  ok: true;
  apiVersion: string;
  schemaVersion: string;
}

export type ApiClientError =
  { code: 'NETWORK_UNAVAILABLE' } | { code: 'SERVICE_UNAVAILABLE' } | { code: 'INVALID_RESPONSE' };

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiClientError };

function isApiHealth(value: unknown): value is ApiHealth {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.ok === true &&
    typeof candidate.apiVersion === 'string' &&
    typeof candidate.schemaVersion === 'string'
  );
}

export async function getApiHealth(fetcher: typeof fetch = fetch): Promise<ApiResult<ApiHealth>> {
  try {
    const origin = globalThis.location?.origin ?? 'http://localhost';
    const baseUrl = new URL(import.meta.env?.BASE_URL ?? '/', origin);
    const response = await fetcher(new URL('api/health', baseUrl), {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return { ok: false, error: { code: 'SERVICE_UNAVAILABLE' } };
    const value: unknown = await response.json();
    return isApiHealth(value)
      ? { ok: true, value }
      : { ok: false, error: { code: 'INVALID_RESPONSE' } };
  } catch {
    return { ok: false, error: { code: 'NETWORK_UNAVAILABLE' } };
  }
}
