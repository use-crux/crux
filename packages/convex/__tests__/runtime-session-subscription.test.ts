import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import { describe, expect, it } from 'vitest'
import {
  sessionSubscriptionMatchKey,
  sessionSubscriptionMatchValue,
} from '@use-crux/core/runtime/internal/session-store'
import schema from '../src/component/schema'
import { convexRuntimeStore } from '../src/runtime'
import {
  runtimePublicWorkComponent,
  runtimePublicWorkCtx,
  runtimePublicWorkModules,
} from './runtime-public-work-fixture'

const modules = {
  ...runtimePublicWorkModules,
  '../src/component/runtime/session_execution.ts': () =>
    import('../src/component/runtime/session_execution'),
  '../src/component/runtime/session_helpers.ts': () =>
    import('../src/component/runtime/session_helpers'),
  '../src/component/runtime/session_identity.ts': () =>
    import('../src/component/runtime/session_identity'),
  '../src/component/runtime/session_port.ts': () =>
    import('../src/component/runtime/session_port'),
  '../src/component/runtime/session_subscriptions.ts': () =>
    import('../src/component/runtime/session_subscriptions'),
  '../src/component/runtime/sessions.ts': () =>
    import('../src/component/runtime/sessions'),
  '../src/component/runtime/session_checkpoint.ts': () =>
    import('../src/component/runtime/session_checkpoint'),
} satisfies Record<string, () => Promise<unknown>>

function matchKeyFor(match: { env: string; repo: string }) {
  return sessionSubscriptionMatchKey(sessionSubscriptionMatchValue(match))
}

function createStore() {
  const test = convexTest({ schema, modules })
  const base = runtimePublicWorkComponent()
  const component = {
    ...base,
    runtime: {
      ...base.runtime,
      sessions: { run: makeFunctionReference('runtime/sessions:run') },
    },
  }
  const now = new Date('2026-08-05T00:00:00.000Z')
  const store = convexRuntimeStore({
    ctx: runtimePublicWorkCtx(test),
    component,
    now: () => now,
  })
  return { store, now, test }
}

async function prepareFlowSession(
  store: ReturnType<typeof createStore>['store'],
  now: Date,
) {
  const sessions = store.sessions
  if (!sessions) throw new Error('Expected Session port')
  await sessions.create({
    namespace: 'convex-sub-ns',
    sessionId: 'session_convex_sub_1',
    keyHash: 'key_convex_sub_1',
    targetId: 'flow-sub',
    targetKind: 'flow',
    threadId: 'thread_convex_sub_1',
    definition: {
      targetId: 'flow-sub' as never,
      definitionId: 'flow:flow-sub',
      fingerprint: 'v1',
      manifestHash: 'manifest-v1',
    },
    now,
  })
  await sessions.markReady('convex-sub-ns', 'session_convex_sub_1', now)
  return sessions
}

describe('Convex Session subscription port', () => {
  it('upserts by canonical key-order match identity and reactivates after unsubscribe', async () => {
    const { store, now } = createStore()
    const sessions = await prepareFlowSession(store, now)
    const match = { env: 'prod', repo: 'crux' }
    const matchKey = matchKeyFor(match)
    const first = await sessions.upsertSubscription({
      namespace: 'convex-sub-ns',
      sessionId: 'session_convex_sub_1',
      subscriptionId: 'subscription_a',
      signalId: 'orders.changed',
      match,
      matchKey,
      now,
    })
    const second = await sessions.upsertSubscription({
      namespace: 'convex-sub-ns',
      sessionId: 'session_convex_sub_1',
      subscriptionId: 'subscription_b',
      signalId: 'orders.changed',
      match: { repo: 'crux', env: 'prod' },
      matchKey,
      now: new Date(now.getTime() + 1_000),
    })
    expect(second.subscriptionId).toBe(first.subscriptionId)
    expect(second.matchKey).toBe(first.matchKey)

    await sessions.unsubscribe(
      'convex-sub-ns',
      'session_convex_sub_1',
      first.subscriptionId,
      new Date(now.getTime() + 2_000),
    )
    const reactivated = await sessions.upsertSubscription({
      namespace: 'convex-sub-ns',
      sessionId: 'session_convex_sub_1',
      subscriptionId: first.subscriptionId,
      signalId: 'orders.changed',
      match,
      matchKey,
      now: new Date(now.getTime() + 3_000),
    })
    expect(reactivated.subscriptionId).toBe(first.subscriptionId)
    expect(reactivated.state).toBe('active')
    const listed = await sessions.listSubscriptions(
      'convex-sub-ns',
      'session_convex_sub_1',
    )
    expect(listed).toHaveLength(1)
  })

  it('keeps one row under concurrent same-key upserts', async () => {
    const { store, now } = createStore()
    const sessions = await prepareFlowSession(store, now)
    const match = { env: 'prod', repo: 'crux' }
    const matchKey = matchKeyFor(match)
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        sessions.upsertSubscription({
          namespace: 'convex-sub-ns',
          sessionId: 'session_convex_sub_1',
          subscriptionId: `subscription_race_${index}`,
          signalId: 'orders.changed',
          match: index % 2 === 0 ? match : { repo: 'crux', env: 'prod' },
          matchKey,
          now: new Date(now.getTime() + index),
        }),
      ),
    )
    const ids = new Set(results.map((row) => row.subscriptionId))
    expect(ids.size).toBe(1)
    const listed = await sessions.listSubscriptions(
      'convex-sub-ns',
      'session_convex_sub_1',
    )
    expect(listed).toHaveLength(1)
    expect(listed[0]?.subscriptionId).toBe(results[0]?.subscriptionId)
  })
})
