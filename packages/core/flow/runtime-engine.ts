/**
 * Runtime Engine support for flow execution.
 *
 * Flow authoring stays in `scope.ts`; this module holds the runtime-specific
 * adapters between existing flow replay state and the Runtime Engine snapshot,
 * event, and target contracts.
 *
 * @module
 */

import type { JsonValue } from '../storage'
import type { ResolvedRuntimeEngine } from '../runtime/api/create-runtime'
import type { RuntimeTargetOutcome } from '../runtime/engine/kernel'
import type { ReplayFingerprint } from '../runtime/engine/replay'
import type { WorkItem } from '../runtime/engine/work'
import type {
  EventCursor,
  FlowId as RuntimeFlowId,
  WorkId,
} from '../runtime/ports/ids'
import type { RuntimeEvent } from '../runtime/ports/events'
import type { FlowSnapshot as RuntimeFlowSnapshot } from '../runtime/ports/state'
import type { FlowResult } from './types'
import { assertFlowJsonValue } from './serialization'

/** Mutable execution bridge for one runtime-backed flow target invocation. */
export interface RuntimeFlowExecution {
  /** Resolved Runtime Engine handling the current wake. */
  readonly runtime: ResolvedRuntimeEngine
  /** Leased flow work item being replayed. */
  readonly work: WorkItem
  /** Runtime-owned flow snapshot loaded before replay. */
  readonly snapshot: RuntimeFlowSnapshot
  /** Fingerprint checker for deploy-drift detection. */
  readonly fingerprint: ReplayFingerprint
  /** Delivered event payloads keyed by suspend label. */
  readonly deliveredPayloads: ReadonlyMap<string, JsonValue>
  /** Kernel outcome produced by the flow executor. */
  outcome?: RuntimeTargetOutcome
  /** Object-bound result returned to the caller when execution is inline. */
  result?: FlowResult<unknown>
}

/** Shared state between a resolved runtime and its flow target closure. */
export interface RuntimeFlowTargetRef {
  /** Resolved runtime instance. */
  current?: ResolvedRuntimeEngine
  /** Flow result observed during inline object-bound execution. */
  result?: FlowResult<unknown>
}

/** Convert a runtime snapshot's output-only step cache into legacy executor cache records. */
export function completedStepsFromRuntimeSnapshot(
  snapshot: RuntimeFlowSnapshot,
): Record<string, { output: JsonValue; durationMs: number }> {
  const completedSteps: Record<string, { output: JsonValue; durationMs: number }> = {}
  for (const [label, output] of Object.entries(snapshot.completedSteps)) {
    completedSteps[label] = { output, durationMs: 0 }
  }
  return completedSteps
}

/** Convert legacy executor cache records into the runtime snapshot shape. */
export function runtimeCompletedSteps(
  completedSteps: Record<string, { output: JsonValue; durationMs: number }>,
): Record<string, JsonValue> {
  const runtimeSteps: Record<string, JsonValue> = {}
  for (const [label, completed] of Object.entries(completedSteps)) {
    runtimeSteps[label] = completed.output
  }
  return runtimeSteps
}

/** Normalize a flow input for the runtime's JSON-only snapshot boundary. */
export function runtimeInputValue(input: unknown): JsonValue {
  if (input === undefined) return null
  assertFlowJsonValue(input, { boundary: 'flow input' })
  return input as JsonValue
}

/** Build a runtime-owned flow snapshot from the current executor state. */
export function runtimeFlowSnapshot(
  execution: RuntimeFlowExecution,
  options: {
    readonly status: RuntimeFlowSnapshot['status']
    readonly input: unknown
    readonly completedSteps: Record<string, { output: JsonValue; durationMs: number }>
  },
): RuntimeFlowSnapshot {
  return {
    flowId: execution.snapshot.flowId,
    workId: execution.work.workId,
    targetId: execution.work.targetId,
    namespace: execution.work.namespace,
    status: options.status,
    input: runtimeInputValue(options.input),
    completedSteps: runtimeCompletedSteps(options.completedSteps),
    fingerprint: execution.fingerprint.observed,
    pendingSuspends: [],
    updatedAt: new Date(),
  }
}

/** Return the flow id carried by runtime work that is valid for a flow target. */
export function flowIdForRuntimeWork(work: WorkItem): RuntimeFlowId {
  switch (work.work.kind) {
    case 'flow.resume':
    case 'flow.timeout':
      return work.work.flowId
    case 'task.run':
    case 'watch.deliver':
      throw new Error(`Runtime target \`${work.targetId}\` received non-flow work \`${work.work.kind}\`.`)
  }
}

/** Load delivered suspend payloads from the runtime event log. */
export async function deliveredRuntimePayloads(
  runtime: ResolvedRuntimeEngine,
  snapshot: RuntimeFlowSnapshot,
): Promise<ReadonlyMap<string, JsonValue>> {
  const delivered = new Map<string, JsonValue>()
  for (const suspend of snapshot.pendingSuspends) {
    if (!suspend.delivered) continue
    const event = await readRuntimeEvent(runtime, snapshot.namespace, suspend.delivered.eventId)
    if (event) delivered.set(suspend.label, event.payload)
  }
  return delivered
}

let runtimeWorkCounter = 0

/** Generate a local runtime work id for object-bound in-process flow starts. */
export function runtimeWorkId(): WorkId {
  runtimeWorkCounter += 1
  return `work_${Date.now().toString(36)}_${runtimeWorkCounter}_${Math.random().toString(36).slice(2, 8)}` as WorkId
}

/** Return the work id generator shape expected by `createRuntime()`. */
export function createRuntimeWorkIdGenerator(): () => WorkId {
  return runtimeWorkId
}

/** Build the idempotency key for the first object-bound runtime flow delivery. */
export function runtimeStartIdempotencyKey(workId: WorkId): string {
  return `resume:${workId}:start`
}

/** Build a unique event id for object-bound `FlowHandle.signal()` deliveries. */
export function runtimeSignalEventId(flowId: string, signalName: string): string {
  runtimeWorkCounter += 1
  return `signal:${flowId}:${signalName}:${Date.now().toString(36)}:${runtimeWorkCounter}`
}

async function readRuntimeEvent(
  runtime: ResolvedRuntimeEngine,
  namespace: string,
  eventId: EventCursor,
): Promise<RuntimeEvent | undefined> {
  const result = await runtime.store.events.read({ namespace })
  return result.events.find((event) => event.eventId === eventId)
}
