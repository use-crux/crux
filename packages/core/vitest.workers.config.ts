import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'
import * as esbuild from 'esbuild'

/**
 * Dedicated Vitest project for Phase 7 Cloudflare Workers conformance tests.
 *
 * Runs `__tests__/observability/workers/**` inside a real workerd isolate via
 * `@cloudflare/vitest-pool-workers`, not a mocked global or `@edge-runtime/vm`.
 * The fixture Worker's `wrangler.jsonc` intentionally omits `nodejs_compat` so
 * this suite doubles as proof that the default `@use-crux/core/observability`
 * and `@use-crux/core/observability/workers` import graphs do not require it.
 *
 * `miniflare.workers` registers a second, genuinely separate named Worker
 * (`fixtures/resumer-worker.ts`) reachable only via the primary worker's
 * `RESUMER` service binding declared in `fixtures/wrangler.jsonc`. Only the
 * pool's own `wrangler.configPath` worker gets the pool's Vite/TypeScript
 * transform, so the auxiliary worker is pre-bundled to plain ESM with
 * esbuild here (once, at config load) before being handed to Miniflare —
 * the same pattern `serverless-freeze.test.ts` uses for its Node harness.
 *
 * The resumer worker does NOT enable `nodejs_compat`, matching the primary
 * worker. Miniflare's pool-worker module locator statically resolves every
 * `import()` specifier reachable in a pre-bundled `scriptPath` worker's
 * source before running anything - including the existing lazy, try/catch
 * -guarded `import('node:diagnostics_channel')` fallback in
 * `observability/channel.ts`, which is never actually reached at runtime
 * (`process.getBuiltinModule` resolves it directly) but still trips the
 * locator merely by being present in the bundle. `stubDiagnosticsChannel`
 * below is a narrow esbuild plugin, scoped to this one test bundle only,
 * that replaces `observability/channel.ts` with an inert stub with the same
 * two exports and no dynamic `node:` import; production `channel.ts` is
 * untouched. The primary worker never hits this because it loads through
 * the pool's own Vite pipeline instead of a raw pre-bundled `scriptPath`.
 */
const here = dirname(fileURLToPath(import.meta.url))
const resumerEntry = join(here, '__tests__/observability/workers/fixtures/resumer-worker.ts')
const moduleScopeEntry = join(here, '__tests__/observability/workers/fixtures/module-scope-worker.ts')
const channelModulePath = join(here, 'src/observability/channel.ts')

/** Test-harness-only stub: same exports as `observability/channel.ts`, no `node:` import. */
const stubDiagnosticsChannel: esbuild.Plugin = {
  name: 'stub-diagnostics-channel',
  setup(build) {
    build.onLoad({ filter: /^.*$/, namespace: 'file' }, (args) => {
      if (args.path !== channelModulePath) return undefined
      return {
        contents: `
          export const CRUX_OBSERVABILITY_CHANNEL = 'crux:observability'
          export function publishObservabilityChannel() {}
          export function channelHasSubscribers() { return false }
        `,
        loader: 'js',
      }
    })
  },
}

// workerd's own sandboxed filesystem access refuses a scriptPath outside the
// project tree ("can't use '..' to break out of starting directory"), so the
// bundle must land under this package, not the OS temp directory. `.tmp/` is
// repo-gitignored.
const resumerBundleDir = join(here, '.tmp/observability-workers-resumer')
mkdirSync(resumerBundleDir, { recursive: true })
const resumerBundlePath = join(resumerBundleDir, 'resumer-worker.mjs')
const moduleScopeBundlePath = join(resumerBundleDir, 'module-scope-worker.mjs')

await esbuild.build({
  entryPoints: [resumerEntry],
  outfile: resumerBundlePath,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  plugins: [stubDiagnosticsChannel],
})

await esbuild.build({
  entryPoints: [moduleScopeEntry],
  outfile: moduleScopeBundlePath,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  plugins: [stubDiagnosticsChannel],
})

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './__tests__/observability/workers/fixtures/wrangler.jsonc' },
      miniflare: {
        workers: [
          {
            name: 'crux-observability-workers-resumer',
            modules: true,
            scriptPath: resumerBundlePath,
            compatibilityDate: '2026-01-01',
          },
          {
            name: 'crux-observability-workers-module-scope-check',
            modules: true,
            scriptPath: moduleScopeBundlePath,
            compatibilityDate: '2026-01-01',
          },
        ],
      },
    }),
  ],
  test: {
    include: ['__tests__/observability/workers/**/*.test.ts'],
  },
})
