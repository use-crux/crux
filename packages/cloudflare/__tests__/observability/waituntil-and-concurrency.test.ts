import { env } from 'cloudflare:workers'
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import worker, { deliveredRecords, resetFixture } from './fixtures/worker'

describe('Workers waitUntil defers the drain past the returned response', () => {
  beforeEach(() => resetFixture())

  it('returns the response before delivery, then delivers once waitOnExecutionContext resolves', async () => {
    // A slow transport makes the race deterministic: the send is provably
    // still in flight when fetch() resolves, so "nothing delivered yet" is
    // a real assertion about waitUntil ordering, not a timing coincidence
    // with the delivery engine's own zero-delay batching timer.
    resetFixture({ transportDelayMs: 50 })
    const ctx = createExecutionContext()
    const request = new Request('http://fixture.test/emit?requestId=r1')

    const response = await worker.fetch(request, env, ctx)
    expect(response.status).toBe(200)
    // The response already resolved; the drain is only registered with
    // ctx.waitUntil(), not awaited inline, so nothing has been sent yet.
    expect(deliveredRecords().length).toBe(0)

    await waitOnExecutionContext(ctx)
    expect(deliveredRecords().length).toBeGreaterThan(0)
  })

  it('still drains when the handler throws, and rethrows the original error', async () => {
    const ctx = createExecutionContext()
    const request = new Request('http://fixture.test/emit-and-throw?requestId=r2')

    await expect(worker.fetch(request, env, ctx)).rejects.toThrow('intentional failure for r2')
    await waitOnExecutionContext(ctx)
    expect(deliveredRecords().length).toBeGreaterThan(0)
  })
})

describe('concurrent request isolation', () => {
  beforeEach(() => resetFixture())

  it('delivers every concurrent request record exactly once with no cross-request loss', async () => {
    const requestIds = Array.from({ length: 8 }, (_, i) => `concurrent-${i}`)
    const contexts = requestIds.map(() => createExecutionContext())

    const responses = await Promise.all(
      requestIds.map((requestId, i) =>
        worker.fetch(new Request(`http://fixture.test/emit?requestId=${requestId}`), env, contexts[i]!),
      ),
    )
    for (const response of responses) expect(response.status).toBe(200)

    await Promise.all(contexts.map((ctx) => waitOnExecutionContext(ctx)))

    const names = deliveredRecords()
      .filter((record) => record.type === 'run:start')
      .map((record) => (record as { name?: string }).name)
    for (const requestId of requestIds) {
      expect(names.filter((name) => name === `workers-request-${requestId}`)).toHaveLength(1)
    }
  })
})
