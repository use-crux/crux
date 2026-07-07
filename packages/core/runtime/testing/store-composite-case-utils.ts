import type {
  FlowId,
  LeaseToken,
  RuntimeTargetId,
  TaskId,
  WorkId,
} from '../ports'
import {
  runDefaultRuntimeComposite,
  type RuntimeCompositeInput,
  type RuntimeCompositeKind,
  type RuntimeCompositeResult,
} from '../engine/composites'
import type { WorkItem } from '../engine/work'
import type { RuntimeStoreAdapter } from '../store'
import { makeConformanceWorkItem } from './store-fixtures'
import type { RunStoreAdapterTestsOptions } from './store-types'

export const NOW = new Date('2026-07-02T00:00:00.000Z')
export const LATER = new Date('2026-07-02T00:00:10.000Z')
export const NAMESPACE = 'tenant-a'
export const FLOW_ID = 'flow_1' as FlowId
export const LEASE_TOKEN = 'lease_token_1' as LeaseToken
export const TASK_ID = 'task_1' as TaskId
export const TARGET_ID = 'review' as RuntimeTargetId

export interface StoreCompositeRollbackCase {
  readonly kind: RuntimeCompositeKind
  readonly writesBeforeFailure: number
  readonly prepare?: (store: RuntimeStoreAdapter) => Promise<void>
  readonly verifyRollback: (store: RuntimeStoreAdapter) => Promise<void>
  readonly run: (store: RuntimeStoreAdapter) => Promise<void>
}

export function leasedWork(overrides: Partial<WorkItem> = {}): WorkItem {
  return makeConformanceWorkItem({
    status: 'leased',
    leaseToken: LEASE_TOKEN,
    ...overrides,
  })
}

export function runComposite<K extends RuntimeCompositeKind>(
  store: RuntimeStoreAdapter,
  kind: K,
  input: RuntimeCompositeInput[K],
): Promise<RuntimeCompositeResult[K]> {
  const runner =
    store.runComposite ??
    ((compositeKind, compositeInput) =>
      runDefaultRuntimeComposite(
        store,
        {
          now: () => NOW,
          newWorkId: () => 'work_child_1' as WorkId,
        },
        compositeKind,
        compositeInput,
      ))

  return runner(kind, input)
}

export function requireFaultHook<TStore extends RuntimeStoreAdapter>(
  hook: RunStoreAdapterTestsOptions<TStore>['failAfterWrites'],
): (store: TStore, writes: number) => void {
  if (hook) return hook

  throw new Error(
    'Runtime store conformance requires failAfterWrites unless substrateAtomicTransact is declared.',
  )
}
