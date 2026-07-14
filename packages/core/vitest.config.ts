import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    // Exercise the new workspace package through its declared public name
    // without introducing a reverse Core -> MCP package dependency.
    alias: {
      '@use-crux/mcp': fileURLToPath(
        new URL('../mcp/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['__tests__/**/*.test.ts'],
    // Cloudflare Workers conformance tests require the
    // `@cloudflare/vitest-pool-workers` pool (`cloudflare:test`/
    // `cloudflare:workers` only resolve there) and run under the dedicated
    // `vitest.workers.config.ts` via `test:observability:workers` instead.
    exclude: ['**/node_modules/**', '__tests__/observability/workers/**'],
  },
})
