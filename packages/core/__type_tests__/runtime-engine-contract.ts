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
  InMemoryRuntimeStore,
  RuntimeTargetId,
  RuntimeStoreAdapter,
  RuntimeWork,
  TaskId,
  WorkId,
} from '@use-crux/core/runtime'
import { inMemoryRuntimeStore } from '@use-crux/core/runtime'
import { runStoreAdapterTests } from '@use-crux/core/runtime/testing'

declare const workId: WorkId
declare const flowId: FlowId
declare const taskId: TaskId
declare const targetId: RuntimeTargetId
declare const cursor: EventCursor

expectTypeOf(workId).toMatchTypeOf<string>()
expectTypeOf(flowId).toMatchTypeOf<string>()

// @ts-expect-error Branded runtime ids must not be interchangeable.
const wrongFlowId: FlowId = workId
void wrongFlowId

const workItems: readonly RuntimeWork[] = [
  { kind: 'flow.resume', flowId },
  { kind: 'flow.timeout', flowId, suspendPoint: 'approval' },
  { kind: 'task.run', taskId, targetId },
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

expectTypeOf(inMemoryRuntimeStore()).toMatchTypeOf<RuntimeStoreAdapter>()

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
