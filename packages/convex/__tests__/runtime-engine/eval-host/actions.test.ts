import { describe, expect, it } from 'vitest'
import { createRuntimeWithHostContext } from '@use-crux/core/runtime'
import { createConvexEvalHost } from '../../../src/runtime-node'
import type { ConvexRuntimeComponent } from '../../../src/runtime'
import { convex } from '../../../src/runtime'
import { fixtureRegistry, NOW, TOKEN } from './fixture'
import { jobBody } from './fixture'
import { createConvexEvalActionHarness } from './action-harness'

const component = {
  runtime: {
    state: {},
    events: {},
    waiters: {},
    timers: {},
    outbox: {},
    leases: {},
    results: { put: {}, get: {}, deleteResult: {}, pruneUnreferenced: {} },
    evalHost: { admit: {} },
  },
} satisfies ConvexRuntimeComponent

describe('createConvexEvalHost()', () => {
  it('keeps the Eval action capability separate from the local Runtime Bridge', async () => {
    const actions = createConvexEvalHost({
      component,
      registry: fixtureRegistry(),
      deploymentId: 'production-eu',
      token: TOKEN,
      now: () => NOW,
    })
    const ctx = {
      runMutation: async () => {
        throw new Error('Manifest/auth reads must not touch durable state.')
      },
      scheduler: { runAfter: async () => undefined },
    }
    const unauthorized = await actions.handleEvalRequest._handler!(
      ctx as never,
      request('/manifest', 'Bearer local-runtime-bridge'),
    )
    const authorized = await actions.handleEvalRequest._handler!(ctx as never, request('/manifest', `Bearer ${TOKEN}`))

    expect(unauthorized.status).toBe(401)
    expect(authorized.status).toBe(200)
    await expect(authorized.json()).resolves.toMatchObject({
      protocol: 'crux.eval-host.v1',
      hostKind: 'convex',
      evals: [{ id: 'support' }],
    })
  })

  it('survives action reconstruction and duplicate scheduled delivery with one result ref', async () => {
    const harness = createConvexEvalActionHarness()
    const registry = fixtureRegistry(async (input) => {
      await Promise.resolve()
      const nested = createRuntimeWithHostContext({
        runtime: convex(),
        startMaintenance: false,
      })
      nested.dispose()
      return { output: input }
    })
    const actions = createConvexEvalHost({
      component: harness.component,
      registry,
      deploymentId: 'production-eu',
      token: TOKEN,
      now: () => NOW,
    })
    const body = jobBody(registry)

    const admitted = await actions.handleEvalRequest._handler!(
      harness.ctx as never,
      request('/jobs', `Bearer ${TOKEN}`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    )
    expect(admitted.status).toBe(202)
    expect(harness.scheduled).toHaveLength(1)

    const reconstructed = createConvexEvalHost({
      component: harness.component,
      registry,
      deploymentId: 'production-eu',
      token: TOKEN,
      now: () => NOW,
    })
    const envelope = harness.scheduled[0]!
    await reconstructed.executeEvalTarget._handler!(harness.ctx as never, {
      envelope,
    })
    await reconstructed.executeEvalTarget._handler!(harness.ctx as never, {
      envelope,
    })

    const poll = await reconstructed.handleEvalRequest._handler!(
      harness.ctx as never,
      request(`/jobs/${body.jobId}`, `Bearer ${TOKEN}`),
    )
    expect(poll.status).toBe(200)
    await expect(poll.json()).resolves.toMatchObject({
      status: 'succeeded',
      result: { output: { message: 'Refund please' } },
      resultRef: { location: expect.stringMatching(/^convex:/) },
    })
    const work = await harness.memory.state.getWork(`eval-job:${body.jobId}` as never, {
      namespace: 'eval-host:production-eu',
    })
    expect(work).toMatchObject({
      status: 'completed',
      resultRef: { location: expect.any(String) },
    })
    expect(work).not.toHaveProperty('result')
  })

  it('rejects stale registry identity before durable admission', async () => {
    const harness = createConvexEvalActionHarness()
    const registry = fixtureRegistry()
    const actions = createConvexEvalHost({
      component: harness.component,
      registry,
      deploymentId: 'production-eu',
      token: TOKEN,
      now: () => NOW,
    })
    const stale = { ...jobBody(registry), caseFingerprint: 'stale' }

    const response = await actions.handleEvalRequest._handler!(
      harness.ctx as never,
      request('/jobs', `Bearer ${TOKEN}`, {
        method: 'POST',
        body: JSON.stringify(stale),
      }),
    )

    expect(response.status).toBe(409)
    await expect(harness.memory.state.countWork({ namespace: 'eval-host:production-eu' })).resolves.toEqual([])
  })
})

function request(path: string, authorization: string, init: RequestInit = {}): Request {
  return new Request(`https://convex.example${path}`, {
    ...init,
    headers: {
      authorization,
      'content-type': 'application/json',
      ...init.headers,
    },
  })
}
