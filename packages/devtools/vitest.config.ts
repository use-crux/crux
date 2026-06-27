import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'ui/src'),
    },
  },
  test: {
    include: ['ui/src/**/*.test.ts', 'ui/src/**/*.test.tsx'],
  },
})
