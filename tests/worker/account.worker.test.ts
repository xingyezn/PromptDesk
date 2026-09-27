import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../../worker/index';

const origin = 'https://promptdesk-preview.openedutools.workers.dev';

describe('Worker account lifecycle without email delivery', () => {
  it('registers, signs in with secure cookies, signs out, and deletes a synthetic account', async () => {
    const signupContext = createExecutionContext();
    const signup = await worker.fetch(
      new Request(`${origin}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify({
          name: 'Synthetic Test User',
          email: 'promptdesk-test@example.test',
          password: 'synthetic-password-12',
        }),
      }),
      env,
      signupContext,
    );
    await waitOnExecutionContext(signupContext);
    expect(signup.status).toBe(200);
    expect(signup.headers.get('cache-control')).toBe('no-store');
    expect(
      await env.DB.prepare('SELECT emailVerified FROM user WHERE email = ?')
        .bind('promptdesk-test@example.test')
        .first(),
    ).toMatchObject({ emailVerified: 0 });

    const signInContext = createExecutionContext();
    const signIn = await worker.fetch(
      new Request(`${origin}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify({
          email: 'promptdesk-test@example.test',
          password: 'synthetic-password-12',
        }),
      }),
      env,
      signInContext,
    );
    await waitOnExecutionContext(signInContext);
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers.get('set-cookie');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
    expect(signIn.headers.get('referrer-policy')).toBe('no-referrer');

    const sessionCookie = cookie?.split(';')[0];
    expect(sessionCookie).toBeTruthy();
    const signOutContext = createExecutionContext();
    const signOut = await worker.fetch(
      new Request(`${origin}/api/auth/sign-out`, {
        method: 'POST',
        headers: { cookie: sessionCookie!, origin },
      }),
      env,
      signOutContext,
    );
    await waitOnExecutionContext(signOutContext);
    expect(signOut.status).toBe(200);
    expect(signOut.headers.get('set-cookie')).toContain('Max-Age=0');

    const deleteSignInContext = createExecutionContext();
    const deleteSignIn = await worker.fetch(
      new Request(`${origin}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify({
          email: 'promptdesk-test@example.test',
          password: 'synthetic-password-12',
        }),
      }),
      env,
      deleteSignInContext,
    );
    await waitOnExecutionContext(deleteSignInContext);
    const deleteCookie = deleteSignIn.headers.get('set-cookie')?.split(';')[0];
    expect(deleteSignIn.status).toBe(200);
    expect(deleteCookie).toBeTruthy();

    const deleteContext = createExecutionContext();
    const deleteAccount = await worker.fetch(
      new Request(`${origin}/api/auth/delete-user`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: deleteCookie!, origin },
        body: JSON.stringify({ password: 'synthetic-password-12' }),
      }),
      env,
      deleteContext,
    );
    await waitOnExecutionContext(deleteContext);
    expect(deleteAccount.status).toBe(200);
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS count FROM user WHERE email = ?')
        .bind('promptdesk-test@example.test')
        .first(),
    ).toMatchObject({ count: 0 });
  });

  it('disables verification and password-reset endpoints without sending email', async () => {
    for (const path of [
      '/api/auth/request-password-reset',
      '/api/auth/send-verification-email',
      '/api/auth/verify-email',
    ]) {
      const response = await worker.fetch(
        new Request(`${origin}${path}`, {
          method: path.endsWith('verify-email') ? 'GET' : 'POST',
          headers: { 'content-type': 'application/json', origin },
          ...(path.endsWith('verify-email')
            ? {}
            : { body: JSON.stringify({ email: 'synthetic@example.test' }) }),
        }),
        env,
        createExecutionContext(),
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'EMAIL_FEATURES_DISABLED' });
    }
  });

  it('rejects cross-origin requests and oversized authentication bodies', async () => {
    const csrfContext = createExecutionContext();
    const csrf = await worker.fetch(
      new Request(`${origin}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
        body: JSON.stringify({ email: 'nobody@example.test', password: 'synthetic-password' }),
      }),
      env,
      csrfContext,
    );
    await waitOnExecutionContext(csrfContext);
    expect(csrf.status).toBeGreaterThanOrEqual(400);

    const oversized = await worker.fetch(
      new Request(`${origin}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': '17000' },
        body: 'x'.repeat(17_000),
      }),
      env,
      createExecutionContext(),
    );
    expect(oversized.status).toBe(413);
  });
});
