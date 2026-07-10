/**
 * Type-level contract for `@use-crux/core/runtime`.
 *
 * Pins branded runtime ids and `RuntimeWork` narrowing through the public
 * runtime-engine subpath. These checks run under `tsc --noEmit`; nothing
 * executes at runtime.
 */

import { expectTypeOf } from 'vitest'
import type {
  EventCursor,
  FlowId,
  CruxContextStorage,
  CruxHostLifecycle,
  HostBoundRuntimeEngineDefinition,
  InMemoryRuntimeStore,
  InProcessRuntimeEngineDefinition,
  LeaseToken,
  ResolvedRuntimeEngine,
  RuntimeTaskContext,
  RuntimeTaskTarget,
  RuntimeKernel,
  RuntimeEngineDefinition,
  RuntimePendingSuspend,
  RuntimeTargetId,
  RuntimeStoreAdapter,
  RuntimeWork,
  TaskId,
  WaiterId,
  WorkId,
} from '@use-crux/core/runtime'
import {
  bindHostRuntime,
  createRuntime,
  createRuntimeKernel,
  flowEventResumeKey,
  inMemoryRuntimeStore,
  remainingHostDeadlineMs,
  node,
  runtimeRequiredError,
  runWithRuntimeHost,
  durableTask,
  taskRunKey,
  waiterTimeoutKey,
} from '@use-crux/core/runtime'
import { task as planTask } from '@use-crux/core'
import {
  createTestRuntime,
  runRuntimeEngineAdapterTests,
  runStoreAdapterTests,
  type TestRuntime,
  type TestRuntimeSettleResult,
} from '@use-crux/core/runtime/testing'

declare const workId: WorkId
declare const flowId: FlowId
declare const taskId: TaskId
declare const targetId: RuntimeTargetId
declare const cursor: EventCursor
declare const waiterId: WaiterId

expectTypeOf(workId).toMatchTypeOf<string>()
expectTypeOf(flowId).toMatchTypeOf<string>()

// @ts-expect-error Branded runtime ids must not be interchangeable.
const wrongFlowId: FlowId = workId
void wrongFlowId

const workItems: readonly RuntimeWork[] = [
  { kind: 'flow.resume', flowId },
  { kind: 'flow.timeout', flowId, suspendPoint: 'approval' },
  { kind: 'task.run', taskId, targetId, input: { documentId: 'doc_1' } },
  { kind: 'watch.deliver', subscriptionId: 'workspace', cursor },
]

for (const work of workItems) {
  switch (work.kind) {
    case 'task.run':
      expectTypeOf(work.taskId).toEqualTypeOf<TaskId>()
      expectTypeOf(work.targetId).toEqualTypeOf<RuntimeTargetId>()
      break
    case 'flow.resume':
    case 'flow.timeout':
      expectTypeOf(work.flowId).toEqualTypeOf<FlowId>()
      break
    case 'watch.deliver':
      expectTypeOf(work.cursor).toEqualTypeOf<EventCursor>()
      break
  }
}

// @ts-expect-error Task work needs a task id, not a flow id.
const badTaskWork: RuntimeWork = { kind: 'task.run', taskId: flowId, targetId }
void badTaskWork

const runtimeTask = durableTask('embed-document', {
  run: async (input: { documentId: string }) => input.documentId,
})
expectTypeOf(runtimeTask).toMatchTypeOf<RuntimeTaskTarget<{ documentId: string }>>()
expectTypeOf(runtimeTask.kind).toEqualTypeOf<'task'>()
const ledgerTask = planTask('Draft launch plan')
// @ts-expect-error Plans & Tasks ledger specs are not executable runtime targets.
const wrongRuntimeTask: RuntimeTaskTarget = ledgerTask
void wrongRuntimeTask

const documentedDurableTask = durableTask('documented-embed-document', {
  run: async (input: { documentId: string }, context: RuntimeTaskContext) => {
    expectTypeOf(context.lease.token).toEqualTypeOf<LeaseToken>()
    return input.documentId
  },
})
expectTypeOf(documentedDurableTask).toMatchTypeOf<RuntimeTaskTarget<{ documentId: string }>>()

expectTypeOf(inMemoryRuntimeStore()).toMatchTypeOf<RuntimeStoreAdapter>()

const deliveredSuspend: RuntimePendingSuspend = {
  label: 'approval',
  waiterId,
  delivered: { eventId: cursor, payload: { approved: true } },
}
expectTypeOf(deliveredSuspend.delivered?.eventId).toEqualTypeOf<EventCursor | undefined>()

const kernel = createRuntimeKernel({
  store: inMemoryRuntimeStore(),
  targets: {
    review: {
      targetId,
      kind: 'task',
      execute: async () => ({ status: 'completed' }),
    },
  },
  newWorkId: () => workId,
})
expectTypeOf(kernel).toEqualTypeOf<RuntimeKernel>()
expectTypeOf(flowEventResumeKey(workId, cursor)).toEqualTypeOf<string>()
expectTypeOf(taskRunKey(workId)).toEqualTypeOf<string>()
expectTypeOf(waiterTimeoutKey(waiterId)).toEqualTypeOf<string>()

const runtimeDefinition = node({
  store: inMemoryRuntimeStore(),
  namespace: 'tenant-a',
  autoStartMaintenance: false,
})
expectTypeOf(runtimeDefinition).toMatchTypeOf<RuntimeEngineDefinition<InMemoryRuntimeStore>>()
expectTypeOf(runtimeDefinition).toMatchTypeOf<InProcessRuntimeEngineDefinition<InMemoryRuntimeStore>>()
expectTypeOf(runtimeDefinition.kind).toEqualTypeOf<'in-process'>()
const runtimeDefinitionWithClock = {
  ...runtimeDefinition,
  now: () => new Date('2026-07-07T00:00:00.000Z'),
  newWorkId: () => workId,
} satisfies InProcessRuntimeEngineDefinition<InMemoryRuntimeStore>
expectTypeOf(runtimeDefinitionWithClock.now()).toEqualTypeOf<Date>()
expectTypeOf(runtimeDefinitionWithClock.newWorkId()).toEqualTypeOf<WorkId>()
const resolvedRuntime = createRuntime({
  runtime: runtimeDefinition,
  targets: {},
  newWorkId: () => workId,
  startMaintenance: false,
})
expectTypeOf(resolvedRuntime).toMatchTypeOf<ResolvedRuntimeEngine<InMemoryRuntimeStore>>()
expectTypeOf(resolvedRuntime.store).toEqualTypeOf<InMemoryRuntimeStore>()
expectTypeOf(runtimeRequiredError({ api: 'flow.waitFor()' }).code).toEqualTypeOf<'RUNTIME_REQUIRED'>()

const hostRuntimeDefinition: HostBoundRuntimeEngineDefinition = {
  kind: 'host-bound',
  id: 'convex',
  host: 'convex',
  capabilities: runtimeDefinition.capabilities,
  entry: 'createConvexRuntimeHandlers({ targetExecutor }) in convex/_crux/generated.ts',
}
expectTypeOf(hostRuntimeDefinition).toMatchTypeOf<RuntimeEngineDefinition>()
expectTypeOf(hostRuntimeDefinition.kind).toEqualTypeOf<'host-bound'>()
// @ts-expect-error Host-bound declarations are inert and do not expose stores.
hostRuntimeDefinition.store

const hostBoundRuntime = bindHostRuntime(hostRuntimeDefinition, {
  store: inMemoryRuntimeStore(),
  targets: {},
  newWorkId: () => workId,
  createWake: () => async () => {},
  leaseExtension: false,
  startMaintenance: false,
})
expectTypeOf(hostBoundRuntime).toMatchTypeOf<ResolvedRuntimeEngine<InMemoryRuntimeStore>>()
runWithRuntimeHost(
  {
    host: 'convex',
    bind: () => hostBoundRuntime,
  },
  () => hostBoundRuntime,
)

declare const lifecycleStorage: CruxContextStorage<{ requestId: string }>
const lifecycle: CruxHostLifecycle<{ requestId: string }> = {
  context: lifecycleStorage,
  defer: (task) => void task,
  deadline: () => 1_000,
}
expectTypeOf(lifecycle.context).toEqualTypeOf<CruxContextStorage<{ requestId: string }> | undefined>()
expectTypeOf(remainingHostDeadlineMs(lifecycle)).toEqualTypeOf<number | undefined>()

const testRuntime = createTestRuntime({
  targets: [documentedDurableTask],
  epoch: new Date('2026-07-07T00:00:00.000Z'),
})
expectTypeOf(testRuntime).toMatchTypeOf<TestRuntime>()
expectTypeOf(testRuntime.store).toEqualTypeOf<InMemoryRuntimeStore>()
expectTypeOf(testRuntime.clock.now()).toEqualTypeOf<Date>()
expectTypeOf(testRuntime.clock.advance('2d')).toEqualTypeOf<Promise<TestRuntimeSettleResult>>()

runStoreAdapterTests({
  name: 'type-only-memory-store',
  createStore: () => inMemoryRuntimeStore(),
  failAfterWrites: (store, writes) => {
    expectTypeOf(store).toEqualTypeOf<InMemoryRuntimeStore>()
    expectTypeOf(writes).toEqualTypeOf<number>()
  },
  crashBeforeOutboxConfirm: (store) => {
    expectTypeOf(store).toEqualTypeOf<InMemoryRuntimeStore>()
  },
})

runRuntimeEngineAdapterTests({
  name: 'type-only-runtime-engine',
  createHarness: () => ({
    store: inMemoryRuntimeStore(),
    kernel,
    targetId,
    taskId,
    readExecutionCount: async () => 0,
  }),
})
