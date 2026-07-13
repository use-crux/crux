import { env } from 'cloudflare:workers'
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import worker, { resetFixture } from './fixtures/worker'

interface ResumerEnv {
  RESUMER: { fetch(request: Request): Promise<Response> }
}

/**
 * Proves the explicit W3C/Crux carrier is the correctness path across a
 * genuinely separate Worker, not shared JS memory.
 *
 * `fixtures/resumer-worker.ts` is configured in `vitest.workers.config.ts`
 * as its own named Worker (own module scope, own delivery/transport state)
 * and is reachable from this fixture worker only through the `RESUMER`
 * service binding declared in `fixtures/wrangler.jsonc`. Calling
 * `env.RESUMER.fetch(...)` dispatches a real cross-Worker request through
 * workerd's own service-binding RPC — the resumer never imports, and cannot
 * read, anything from `fixtures/worker.ts`'s module state. The only channel
 * between the two is the JSON carrier in the HTTP request/response bodies,
 * exactly the boundary a real distributed resume (a different process,
 * region, or Worker deployment) would have to cross.
 */
describe('explicit carrier resume across a genuinely separate Worker', () => {
  beforeEach(() => resetFixture())

  it('resumes the same logical run in a fresh segment on a different Worker using only the serialized carrier', async () => {
    const startCtx = createExecutionContext()
    const startResponse = await worker.fetch(new Request('http://fixture.test/continuation/start'), env, startCtx)
    await waitOnExecutionContext(startCtx)
    const { carrier } = (await startResponse.json()) as {
      carrier: { crux: { runId: string; previousSegmentId?: string } }
    }
    expect(carrier.crux.runId).toMatch(/^run_[0-9a-f]{24}$/)

    const resumerEnv = env as unknown as ResumerEnv
    const resumeResponse = await resumerEnv.RESUMER.fetch(
      new Request('http://resumer.test/resume', {
        method: 'POST',
        body: JSON.stringify({ carrier }),
      }),
    )
    expect(resumeResponse.status).toBe(200)
    const resumed = (await resumeResponse.json()) as {
      runId: string
      segmentId: string
      resumeRecordSegmentId?: string
    }
    expect(resumed.runId).toBe(carrier.crux.runId)
    // The resumer worker's own delivered `run:resume` record (from its own,
    // separate transport/module state) matches the segment it reported back.
    expect(resumed.resumeRecordSegmentId).toBe(resumed.segmentId)
    // The resumed segment is fresh, never reused from the carrier's closed segment.
    if (carrier.crux.previousSegmentId) expect(resumed.segmentId).not.toBe(carrier.crux.previousSegmentId)
  })

  it('rejects a hostile/malformed carrier on the resumer Worker instead of silently resuming', async () => {
    const resumerEnv = env as unknown as ResumerEnv
    // The carrier fails W3C/id validation synchronously inside the resumer
    // Worker's own handler; the rejection happens on the far side of the
    // service binding, proving invalid identity is never trusted there
    // either, not just in the process that minted the carrier.
    const response = await resumerEnv.RESUMER.fetch(
      new Request('http://resumer.test/resume', {
        method: 'POST',
        body: JSON.stringify({ carrier: { traceparent: 'not-a-real-traceparent', crux: { runId: 'nope' } } }),
      }),
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/Invalid Crux continuation/) })
  })
})
