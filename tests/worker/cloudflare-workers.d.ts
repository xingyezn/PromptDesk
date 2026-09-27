declare module 'cloudflare:workers' {
  export const env: import('../../worker/index').WorkerEnvironment & {
    TEST_MIGRATIONS: Array<{ name: string; queries: string[] }>;
  };
}
