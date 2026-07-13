/**
 * Runtime Engine port contracts for adapter authors.
 *
 * @module
 */

export type { CruxEngineCapabilities, DeploymentSupport } from './capabilities'
export type {
  AppendEventOptions,
  DurableEventPort,
  NewRuntimeEvent,
  ReadEventsOptions,
  ReadEventsResult,
  RuntimeEvent,
} from './events'
export type {
  DeferredIntentId,
  DeferredScopeId,
  EventCursor,
  FlowId,
  LeaseToken,
  RuntimeTargetId,
  TaskId,
  TimerId,
  WaiterId,
  WorkId,
} from './ids'
export type {
  ListRuntimeDeferredIntentsOptions,
  ListRuntimeDeferredScopesOptions,
  RuntimeDeferredIntent,
  RuntimeDeferredIntentState,
  RuntimeDeferredScope,
  RuntimeDeferredStorePort,
  RuntimeDeferFinalization,
  RuntimeDeferInvocationOutcome,
} from './deferred'
export type { ClaimOptions, Lease, LeasePort, LeaseResource } from './leases'
export type { RuntimePruneOptions, RuntimePruneResult } from './retention'
export type {
  RuntimeSetupApplyOptions,
  RuntimeSetupFinding,
  RuntimeSetupMode,
  RuntimeSetupOptions,
  RuntimeSetupPort,
  RuntimeSetupResult,
} from './setup'
export type {
  FlowSnapshot,
  IdempotencyRecord,
  CountWorkOptions,
  MarkSnapshotDeliveredOptions,
  NewWorkItem,
  RuntimeDeliveredSuspend,
  RuntimePendingSuspend,
  SetWorkPendingOptions,
  WorkStatusCount,
  RuntimeStatePort,
  RuntimeStateReadOptions,
} from './state'
export type {
  NewRuntimeWaiter,
  ResolveWaiterOptions,
  RuntimeWaiter,
  WaiterPort,
} from './waiters'
export type { RuntimeWork } from './work'
