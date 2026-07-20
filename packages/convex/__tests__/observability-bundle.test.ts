import { describe, expect, it } from 'vitest'
import * as esbuild from 'esbuild'

/**
 * Convex functions run in a restricted V8 isolate, not Node. Bundling for the
 * `browser` platform with no configured externals fails to resolve any
 * unguarded `node:*` specifier, so a clean bundle is direct evidence the
 * Convex observability wrapper's import graph stays Convex-runtime-safe.
 * `convex/*` peer packages are left unresolved externally since they are
 * genuinely only available inside a Convex deployment, not this bundle check.
 */
describe('Convex observability import graph has no unsupported Node imports', () => {
  it.each([
    ['@use-crux/convex/observability', '../src/observability.ts'],
    ['@use-crux/convex/runtime', '../src/runtime.ts'],
    ['@use-crux/convex/server', '../src/server.ts'],
    ['@use-crux/convex/swarm', '../src/swarm.ts'],
  ])('%s bundles for the browser platform with no unresolved node: specifiers', async (_label, entry) => {
    const entryPoint = new URL(entry, import.meta.url).pathname
    const result = await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'esm',
      logLevel: 'silent',
      external: ['convex', 'convex/*', '@ai-sdk/provider', '@use-crux/ai', '@use-crux/react'],
    })

    // A clean bundle at all is the primary proof: `platform: 'browser'` with
    // no configured externals fails to resolve any unguarded `node:*` static
    // import. The dynamic, try/catch-guarded `node:diagnostics_channel`
    // fallback in core's channel module (mirrored in the core Workers import
    // graph test) is expected and safe — it degrades gracefully when absent.
    expect(result.errors).toEqual([])
    const bundled = result.outputFiles[0]!.text
    expect(bundled).not.toMatch(/from\s+["']node:/)
  })
})
