/** Concurrent stable-inputId acceptInputs idempotency on Convex. */

import { expect, it } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
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
  '../src/component/runtime/session_checkpoint.ts': () =>
    import('../src/component/runtime/session_checkpoint'),
  '../src/component/runtime/sessions.ts': () =>
    import('../src/component/runtime/sessions'),
} satisfies Record<string, () => Promise<unknown>>

it('stable inputIds accept once without duplicate rows under concurrent calls', async () => {
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
  if (!sessions) throw new Error('Expected Session storage.')
  const namespace = 'session-accept-idemp'
  const sessionId = 'session-accept-1'
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
  const inputId = 'input_sig_convex_race_1'
  await Promise.all([
    store.transact(async (tx) => {
      await tx.sessions!.acceptInputs({
        namespace,
        sessionId,
        inputs: [{ message: 'once' }],
        inputIds: [inputId],
        now,
      })
    }),
    store.transact(async (tx) => {
      await tx.sessions!.acceptInputs({
        namespace,
        sessionId,
        inputs: [{ message: 'once' }],
        inputIds: [inputId],
        now,
      })
    }),
  ])
  const record = await sessions.get(namespace, sessionId)
  expect(record?.acceptedCursor).toBe(1)
  expect(record?.pendingInputs).toBe(1)
  const input = await sessions.getInput(namespace, sessionId, inputId)
  expect(input?.cursor).toBe(1)
})
