import type { WorkId } from '@use-crux/core/runtime'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import { expect, it } from 'vitest'
import schema from '../src/component/schema'
import { convexRuntimeStore } from '../src/runtime'
import {
  runtimePublicWorkComponent,
  runtimePublicWorkCtx,
  runtimePublicWorkModules,
} from './runtime-public-work-fixture'

const modules = {
  ...runtimePublicWorkModules,
  '../src/component/runtime/session_execution.ts': () => import('../src/component/runtime/session_execution'),
  '../src/component/runtime/session_helpers.ts': () => import('../src/component/runtime/session_helpers'),
  '../src/component/runtime/session_identity.ts': () => import('../src/component/runtime/session_identity'),
  '../src/component/runtime/session_port.ts': () => import('../src/component/runtime/session_port'),
  '../src/component/runtime/session_subscriptions.ts': () =>
    import('../src/component/runtime/session_subscriptions'),
  '../src/component/runtime/session_checkpoint.ts': () =>
    import('../src/component/runtime/session_checkpoint'),
  '../src/component/runtime/sessions.ts': () => import('../src/component/runtime/sessions'),
} satisfies Record<string, () => Promise<unknown>>

it('retains prepared Session result artifacts during unreferenced-result pruning', async () => {
  const test = convexTest({ schema, modules })
  const base = runtimePublicWorkComponent()
  const component = {
    ...base,
    runtime: {
      ...base.runtime,
      sessions: { run: makeFunctionReference('runtime/sessions:run') },
    },
  }
  const now = new Date('2026-08-04T00:00:00.000Z')
  const store = convexRuntimeStore({
    ctx: runtimePublicWorkCtx(test),
    component,
    now: () => now,
  })
  const sessions = store.sessions
  if (!sessions || !store.results) throw new Error('Expected durable Session result storage.')
  const namespace = 'session-pruning'
  const sessionId = 'session-pruning-1'
  await sessions.create({
    namespace,
    sessionId,
    keyHash: 'key',
    targetId: 'agent',
    targetKind: 'agent',
    threadId: 'thread',
    model: { definitionId: 'model', fingerprint: 'v1' },
    now,
  })
  await sessions.markReady(namespace, sessionId, now)
  const [accepted] = await sessions.acceptInputs({
    namespace,
    sessionId,
    inputs: [{ message: 'private' }],
    now,
  })
  if (!accepted) throw new Error('Expected accepted Session input.')
  const workId = 'work-session-pruning' as WorkId
  await sessions.reserveTurn({
    namespace,
    sessionId,
    inputId: accepted.inputId,
    workId,
    target: 'agent',
    now,
  })
  await sessions.startTurn({
    namespace,
    sessionId,
    inputId: accepted.inputId,
    now,
  })
  const preparedResultRef = await store.results.put({ output: 'private' }, { namespace })
  await sessions.checkpointPreparedExecution({
    namespace,
    sessionId,
    inputId: accepted.inputId,
    workId,
    preparedResultRef,
    now,
  })

  await expect(
    store.results.pruneUnreferenced({
      namespace,
      before: new Date('2026-08-05T00:00:00.000Z'),
      limit: 10,
    }),
  ).resolves.toEqual({ removed: 0, truncated: false })
  await expect(store.results.get(preparedResultRef)).resolves.toEqual({
    output: 'private',
  })
})
