import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    // Cloudflare Workers conformance tests require the
    // `@cloudflare/vitest-pool-workers` pool (`cloudflare:test`/
    // `cloudflare:workers` only resolve there) and run under the dedicated
    // `vitest.workers.config.ts` via `test:observability:workers` instead.
    exclude: ['**/node_modules/**', '__tests__/observability/workers/**'],
  },
})
