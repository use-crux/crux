import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Semantic analyzer tests create TypeScript Programs over temporary
    // projects. Running those fixtures in parallel makes the exact package
    // test command timeout on local WSL machines, while serial execution stays
    // fast enough and deterministic.
    maxWorkers: 1,
  },
})
