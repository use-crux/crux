import { describe, expect, it } from 'vitest'
import * as esbuild from 'esbuild'

/**
 * Static proof (independent of any particular workerd build's ambient
 * compat) that the default and Workers observability entry points never
 * statically import a Node/Cloudflare-only module. Bundling for the
 * `browser` platform fails to resolve `node:*`/`cloudflare:*` specifiers
 * unless they are `external`, so a clean bundle is direct evidence the
 * import graph is edge-safe without `nodejs_compat`.
 */
describe('observability import graph is edge-safe without nodejs_compat', () => {
  it.each([
    ['@use-crux/core/observability', '../../src/observability/index.ts'],
    ['@use-crux/core/observability/workers', '../../src/observability/workers.ts'],
  ])('%s bundles for the browser platform with no unresolved node:/cloudflare: specifiers', async (_label, entry) => {
    const entryPoint = new URL(entry, import.meta.url).pathname
    const result = await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'esm',
      logLevel: 'silent',
    })

    // A `browser`-platform bundle with no configured `external` list fails
    // to resolve any unguarded `node:*`/`cloudflare:*` static import, so a
    // clean build (no errors) is direct proof none exists. Dynamic,
    // try/catch-guarded runtime lookups (e.g. `process.getBuiltinModule`)
    // are expected and safe — they degrade gracefully when absent, unlike a
    // static import the bundler must resolve up front.
    expect(result.errors).toEqual([])
    const bundled = result.outputFiles[0]!.text
    expect(bundled).not.toMatch(/from\s+["']node:/)
    expect(bundled).not.toMatch(/from\s+["']cloudflare:/)
  })

  it('the Workers wrapper module has no static import of the observability/node subpath or cloudflare:* modules', async () => {
    const entryPoint = new URL('../../src/observability/workers.ts', import.meta.url).pathname
    const result = await esbuild.build({
      entryPoints: [entryPoint],
      bundle: false,
      write: false,
      logLevel: 'silent',
    })
    const source = result.outputFiles[0]!.text
    expect(source).not.toMatch(/from\s+["']\.\/node["']/)
    expect(source).not.toMatch(/from\s+["']cloudflare:/)
  })
})
