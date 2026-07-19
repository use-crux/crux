import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

interface ModuleScopeEnv {
  MODULE_SCOPE_CHECK: { fetch(request: Request): Promise<Response> }
}

/**
 * Regression guard for a real production bug this phase found and fixed:
 * `observe.ts`'s module-level delivery-engine singleton used to mint its
 * `sourceId` (random-value generation) synchronously at construction, so
 * merely importing `@use-crux/core/observability` from a natively-loaded
 * Worker script crashed workerd at startup with "Disallowed operation
 * called within global scope" - before any request ever arrived. This was
 * invisible through `fixtures/worker.ts` because the pool's own Vite
 * pipeline defers module evaluation for the primary `wrangler.configPath`
 * worker; `fixtures/module-scope-worker.ts` is registered as a raw
 * `miniflare.workers` entry (like `resumer-worker.ts`) specifically so this
 * class of bug cannot hide behind that pipeline again.
 */
describe('importing the Cloudflare observability graph does not perform I/O at module scope', () => {
  it('the module-scope-check Worker starts and serves a request without a global-scope violation', async () => {
    const moduleScopeEnv = env as unknown as ModuleScopeEnv
    const response = await moduleScopeEnv.MODULE_SCOPE_CHECK.fetch(new Request('http://module-scope.test/ping'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })
})
