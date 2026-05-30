import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  test: {
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.test.tsx'],
  },
})
