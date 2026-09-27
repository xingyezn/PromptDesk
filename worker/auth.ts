import { betterAuth } from 'better-auth';
import type { D1Database } from '@cloudflare/workers-types';

export interface AuthEnvironment {
  DB: D1Database;
  APP_BASE_URL?: string;
  BETTER_AUTH_SECRET?: string;
}

function createAuthOptions(env: AuthEnvironment | null) {
  const origin = env?.APP_BASE_URL;
  const secret = env?.BETTER_AUTH_SECRET;
  if (env) {
    let parsedOrigin: URL;
    try {
      parsedOrigin = new URL(origin ?? '');
    } catch {
      throw new Error('AUTH_CONFIGURATION_UNAVAILABLE');
    }
    const localHttp =
      parsedOrigin.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(parsedOrigin.hostname);
    if (
      !origin ||
      (!localHttp && parsedOrigin.protocol !== 'https:') ||
      parsedOrigin.pathname !== '/' ||
      !secret ||
      secret.length < 32
    ) {
      throw new Error('AUTH_CONFIGURATION_UNAVAILABLE');
    }
  }
  return {
    ...(env ? { database: env.DB } : {}),
    ...(secret ? { secret } : {}),
    ...(origin ? { baseURL: origin, trustedOrigins: [origin] } : {}),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    rateLimit: {
      enabled: true,
      storage: 'database' as const,
      window: 60,
      max: 30,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60, max: 3 },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      useSecureCookies: origin?.startsWith('https://') ?? false,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax' as const,
        secure: origin?.startsWith('https://') ?? false,
      },
    },
    ...(env ? { logger: { disabled: true } } : {}),
    user: {
      deleteUser: { enabled: true },
    },
  };
}

export function createAuth(env: AuthEnvironment) {
  return betterAuth(createAuthOptions(env));
}

export const schemaAuth = betterAuth({
  ...createAuthOptions(null),
  baseURL: 'http://localhost',
  secret: 'synthetic-schema-only-secret-with-32-characters',
});
export default schemaAuth;
