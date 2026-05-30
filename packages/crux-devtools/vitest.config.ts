import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['ui/src/**/*.test.ts', 'server/__tests__/**/*.test.ts', 'lib/**/*.test.ts'],
  },
})
