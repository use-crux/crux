import { env } from 'cloudflare:workers'
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { afterEach, describe, expect, it } from 'vitest'
import {
  __setAlsForTesting,
  resetObservabilityRuntime,
} from '@use-crux/core/observability'
import { withCrux } from '../../src'
import worker, { deliveredRecords, resetFixture } from './fixtures/worker'

/**
 * `fixtures/wrangler.jsonc` has no `compatibility_flags`, so every test in
 * this project already proves the default `@use-crux/core/observability`
 * and `@use-crux/cloudflare` import graphs load and run in
 * a real workerd isolate with no `nodejs_compat`. This file additionally
 * forces the shared AsyncLocalStorage resolver off (the same seam
 * `__tests__/observability/no-als.test.ts` uses) so passing here can never
 * be an accident of whatever ambient Node compat this particular workerd
 * build happens to expose.
 */
describe('correctness holds with AsyncLocalStorage forced unavailable', () => {
  afterEach(() => __setAlsForTesting('auto'))

  it('emit/end/flush work end to end through the real fixture worker with no ambient context storage', async () => {
    resetFixture()
    __setAlsForTesting(null)
    const ctx = createExecutionContext()

    const response = await worker.fetch(new Request('http://fixture.test/emit?requestId=no-als'), env, ctx)
    expect(response.status).toBe(200)
    await waitOnExecutionContext(ctx)

    expect(deliveredRecords().some((record) => record.type === 'run:start')).toBe(true)
    expect(deliveredRecords().some((record) => record.type === 'run:end')).toBe(true)
  })

  it('observe.withHostLifecycle fails closed for async work instead of silently mis-scoping it across requests', async () => {
    resetObservabilityRuntime()
    __setAlsForTesting(null)
    // This is exactly why the Workers boundary never calls
    // observe.withHostLifecycle() around the handler: without ambient async
    // context there is no safe way to scope defer/deadline per concurrent
    // request, so the ambient API refuses async work instead of leaking it.
    const { observe } = await import('@use-crux/core/observability')
    const outcome = observe.withHostLifecycle({ defer: () => {} }, async () => {
      await Promise.resolve()
      return 'unreachable'
    })
    await expect(outcome).rejects.toThrow(/AsyncLocalStorage/)
  })

  it('contains rejection from detached async work after failing closed', async () => {
    resetObservabilityRuntime()
    __setAlsForTesting(null)
    const unhandled: unknown[] = []
    const onUnhandled = (event: PromiseRejectionEvent) => unhandled.push(event.reason)
    globalThis.addEventListener('unhandledrejection', onUnhandled)

    try {
      const { observe } = await import('@use-crux/core/observability')
      const outcome = observe.withHostLifecycle({ defer: () => {} }, async () => {
        await Promise.resolve()
        throw new Error('detached failure')
      })
      await expect(outcome).rejects.toThrow(/AsyncLocalStorage/)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandled).toEqual([])
    } finally {
      globalThis.removeEventListener('unhandledrejection', onUnhandled)
    }
  })

  it('keeps the host lifecycle available for the synchronous fallback frame only', async () => {
    resetObservabilityRuntime()
    __setAlsForTesting(null)
    const { activeHostLifecycle, observe } = await import('@use-crux/core/observability')

    const deadline = Date.now() + 1_000
    expect(
      observe.withHostLifecycle({ deadline: () => deadline }, () => activeHostLifecycle()?.deadline?.()),
    ).toBe(deadline)
    expect(activeHostLifecycle()).toBeUndefined()
  })

  it('accepts a plain-object CruxExecutionContext, not a Cloudflare-typed one', async () => {
    resetObservabilityRuntime()
    const waited: Promise<unknown>[] = []
    const plainCtx = { waitUntil: (p: Promise<unknown>) => void waited.push(p) }

    const handler = withCrux(async () => 'ok', { context: () => plainCtx })
    await expect(handler()).resolves.toBe('ok')
    expect(waited).toHaveLength(1)
    await waited[0]
  })
})
