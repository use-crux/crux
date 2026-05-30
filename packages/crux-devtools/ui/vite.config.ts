import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// React Compiler config.
//
// The compiler auto-memoizes function components and hooks at build
// time, so we don't have to thread `useMemo` / `useCallback` /
// `React.memo` everywhere by hand. It bails out of components that
// trip its safety checks (mutations in render, ref-of-ref, etc.) and
// leaves them un-transformed — there is no runtime fallback to verify.
//
// `target: 19` pins the output to React 19 APIs (no `react-compiler-
// runtime` shim needed). Run `pnpm exec eslint --plugin react-compiler`
// to surface components the compiler skipped.
const reactCompilerConfig = {
  target: '19',
}

export default defineConfig({
  root: __dirname,
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler', reactCompilerConfig]],
      },
    }),
    tailwindcss(),
  ],
  // Expose `CRUX_*` env vars to the client in addition to the default
  // `VITE_*` prefix. Used for build-time configuration like
  // `CRUX_DOCS_URL`, which the lint UI uses to resolve per-rule docs
  // pages without needing the backend to bake a full URL into each
  // finding.
  envPrefix: ['VITE_', 'CRUX_'],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:4400',
      '/ws': {
        target: 'ws://localhost:4400',
        ws: true,
      },
    },
  },
})
