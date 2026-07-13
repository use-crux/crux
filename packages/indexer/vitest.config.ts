import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Semantic analyzer tests create TypeScript Programs over temporary
    // projects. Running those fixtures in parallel makes the exact package
    // test command timeout on local WSL machines, while serial execution stays
    // fast enough and deterministic.
    maxWorkers: 1,
    // Building a TypeScript Program per fixture routinely runs several seconds
    // and occasionally tips past the 5s default on loaded CI runners, causing
    // flaky timeouts. Give these genuinely slow tests generous headroom.
    testTimeout: 30_000,
  },
})
