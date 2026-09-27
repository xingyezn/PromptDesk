import type { ExecutionContext } from '@cloudflare/workers-types';
import { createAuth, type AuthEnvironment } from './auth';
import { cloudJson, getAccess, handleCloud } from './cloud';

interface StaticAssetsPort {
  fetch(request: Request): Promise<Response>;
}

export interface WorkerEnvironment extends AuthEnvironment {
  ASSETS: StaticAssetsPort;
}

interface SchemaVersionRow {
  version: string;
}

const API_VERSION = '1';
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};
const AUTH_BODY_LIMIT = 16 * 1024;
const DISABLED_EMAIL_AUTH_PATHS = new Set([
  '/api/auth/request-password-reset',
  '/api/auth/send-verification-email',
  '/api/auth/verify-email',
]);

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

async function healthResponse(env: WorkerEnvironment): Promise<Response> {
  try {
    const row = await env.DB.prepare('SELECT value AS version FROM service_meta WHERE key = ?')
      .bind('schema_version')
      .first<SchemaVersionRow>();
    if (!row) return jsonResponse({ error: 'SERVICE_NOT_READY' }, 503);
    return jsonResponse({ ok: true, apiVersion: API_VERSION, schemaVersion: row.version });
  } catch {
    return jsonResponse({ error: 'SERVICE_NOT_READY' }, 503);
  }
}

async function limitAuthRequestBody(request: Request): Promise<Request | Response> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null && Number(declaredLength) > AUTH_BODY_LIMIT) {
    return jsonResponse({ error: 'REQUEST_TOO_LARGE' }, 413);
  }
  if (!request.body) return request;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > AUTH_BODY_LIMIT) {
        await reader.cancel();
        return jsonResponse({ error: 'REQUEST_TOO_LARGE' }, 413);
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request, { body });
}

async function authResponse(request: Request, env: WorkerEnvironment): Promise<Response> {
  let boundedRequest: Request | Response;
  try {
    boundedRequest = await limitAuthRequestBody(request);
  } catch {
    return jsonResponse({ error: 'INVALID_REQUEST' }, 400);
  }
  if (boundedRequest instanceof Response) return boundedRequest;

  try {
    const auth = createAuth(env);
    const path = new URL(request.url).pathname.replace(/\/+$/, '');
    if (path === '/api/auth/sign-up/email') {
      const data: unknown = await boundedRequest.clone().json();
      if (
        typeof data === 'object' &&
        data !== null &&
        'email' in data &&
        typeof data.email === 'string' &&
        data.email.toLowerCase() === 'admin@promptdesk.local'
      ) {
        return cloudJson({ error: 'RESERVED_ACCOUNT' }, 403);
      }
    }
    const session = await auth.api.getSession({ headers: boundedRequest.headers });
    const access = session ? await getAccess(env, session.user.id) : null;
    if (access?.disabled && path !== '/api/auth/sign-out')
      return cloudJson({ error: 'ACCOUNT_DISABLED' }, 403);
    if (access?.role === 'admin' && path === '/api/auth/delete-user')
      return cloudJson({ error: 'ADMIN_PROTECTED' }, 403);
    const response = await auth.handler(boundedRequest);
    if (response.status >= 500) return jsonResponse({ error: 'AUTH_SERVICE_UNAVAILABLE' }, 503);
    if (response.ok && path === '/api/auth/change-password' && session) {
      await env.DB.prepare('UPDATE user_access SET mustChangePassword=0 WHERE userId=?')
        .bind(session.user.id)
        .run();
    }
    if (response.ok && path === '/api/auth/sign-in/email') {
      const data: unknown = await response.clone().json();
      if (
        typeof data === 'object' &&
        data !== null &&
        'user' in data &&
        typeof data.user === 'object' &&
        data.user !== null &&
        'id' in data.user &&
        typeof data.user.id === 'string'
      ) {
        const signedInAccess = await getAccess(env, data.user.id);
        if (signedInAccess?.disabled) {
          await env.DB.prepare('DELETE FROM session WHERE userId=?').bind(data.user.id).run();
          return cloudJson({ error: 'ACCOUNT_DISABLED' }, 403);
        }
      }
    }
    const headers = new Headers(response.headers);
    headers.set('cache-control', 'no-store');
    headers.set('x-content-type-options', 'nosniff');
    headers.set('referrer-policy', 'no-referrer');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return jsonResponse({ error: 'AUTH_SERVICE_UNAVAILABLE' }, 503);
  }
}

export async function handleWorkerRequest(
  request: Request,
  env: WorkerEnvironment,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) {
    return env.ASSETS.fetch(request);
  }

  if (url.pathname === '/api/auth' || url.pathname.startsWith('/api/auth/')) {
    if (DISABLED_EMAIL_AUTH_PATHS.has(url.pathname.replace(/\/+$/, ''))) {
      return jsonResponse({ error: 'EMAIL_FEATURES_DISABLED' }, 404);
    }
    return authResponse(request, env);
  }
  if (url.pathname !== '/api/health') {
    if (!/^\/api\/(?:me|projects(?:\/.*)?|prompts\/.*|admin\/.*)$/.test(url.pathname))
      return jsonResponse({ error: 'NOT_FOUND' }, 404);
    return handleCloud(request, env);
  }
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }), {
      status: 405,
      headers: { ...JSON_HEADERS, allow: 'GET' },
    });
  }
  if (request.body !== null) return jsonResponse({ error: 'BODY_NOT_ALLOWED' }, 400);
  return healthResponse(env);
}

export default {
  fetch(request: Request, env: WorkerEnvironment, ctx: ExecutionContext): Promise<Response> {
    void ctx;
    return handleWorkerRequest(request, env);
  },
};
