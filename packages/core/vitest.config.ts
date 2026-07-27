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
    exclude: ['**/node_modules/**'],
    testTimeout: 30_000,
  },
})
