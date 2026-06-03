import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'ui/src'),
    },
  },
  test: {
    include: ['ui/src/**/*.test.ts', 'server/__tests__/**/*.test.ts', 'lib/**/*.test.ts'],
  },
})
