import { env } from 'cloudflare:workers'
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import worker, { deliveredRecords, fixtureDiagnostics, resetFixture } from './fixtures/worker'

describe('bounded deadline reporting', () => {
  it('truthfully reports a deadline-exceeded drain instead of claiming success', async () => {
    resetFixture({ transportDelayMs: 200 })
    const ctx = createExecutionContext()

    const response = await worker.fetch(new Request('http://fixture.test/emit?requestId=slow&flushTimeoutMs=5'), env, ctx)
    expect(response.status).toBe(200)
    await waitOnExecutionContext(ctx)

    // The transport takes 200ms; the invocation only budgeted 5ms, so the
    // drain cannot complete before waitOnExecutionContext resolves.
    expect(deliveredRecords()).toHaveLength(0)
  })

  it('drains fully when the transport is fast relative to the budget', async () => {
    resetFixture({ transportDelayMs: 0 })
    const ctx = createExecutionContext()

    await worker.fetch(new Request('http://fixture.test/emit?requestId=fast&flushTimeoutMs=5000'), env, ctx)
    await waitOnExecutionContext(ctx)

    expect(deliveredRecords().length).toBeGreaterThan(0)
    expect(fixtureDiagnostics().queuedRecords).toBe(0)
  })
})

describe('bounded byte/record overflow', () => {
  beforeEach(() => resetFixture({ maxQueuedBytes: 256 }))

  it('drops overflow instead of growing the queue unboundedly for an oversized burst', async () => {
    // Slow transport keeps records queued long enough for many concurrent
    // emits to overflow the tiny byte bound before any batch drains.
    resetFixture({ maxQueuedBytes: 256, transportDelayMs: 50 })
    const contexts = Array.from({ length: 20 }, () => createExecutionContext())

    await Promise.all(
      contexts.map((ctx, i) => worker.fetch(new Request(`http://fixture.test/emit?requestId=burst-${i}`), env, ctx)),
    )
    await Promise.all(contexts.map((ctx) => waitOnExecutionContext(ctx)))

    const diagnostics = fixtureDiagnostics()
    expect(diagnostics.overflowDroppedRecords).toBeGreaterThan(0)
    expect(diagnostics.queuedBytes).toBeLessThanOrEqual(256)
  })
})
