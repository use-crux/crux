/**
 * Runtime Engine support for flow execution.
 *
 * Flow authoring stays in `scope.ts`; this module holds the runtime-specific
 * adapters between existing flow replay state and the Runtime Engine snapshot,
 * event, and target contracts.
 *
 * @module
 */

import type { JsonValue } from "../storage";
import type { EffectScopeRef } from "../effect/types";
import type { ResolvedRuntimeEngine } from "../runtime/api/create-runtime";
import type { RuntimeScheduledWorkIntent, RuntimeTargetOutcome } from "../runtime/engine/kernel";
import type { ReplayFingerprint } from "../runtime/engine/replay";
import type { WorkItem } from "../runtime/engine/work";
import type { RuntimeWork } from "../runtime/ports/work";
import type { FlowResumeOptions } from "./types";
import type { FlowId as RuntimeFlowId, WorkId } from "../runtime/ports/ids";
import type {
  FlowSnapshot as RuntimeFlowSnapshot,
  RuntimeDeliveredSuspend,
  RuntimeDeliveredSuspends,
} from "../runtime/ports/state";
import type { FlowResult } from "./types";
import {
  flowOutputForPersistence,
  flowValueForPersistence,
} from "./serialization";
import { createRuntimeError } from "../runtime/engine/errors";

/** Mutable execution bridge for one runtime-backed flow target invocation. */
export interface RuntimeFlowExecution {
  /** Resolved Runtime Engine handling the current wake. */
  readonly runtime: ResolvedRuntimeEngine;
  /** Leased flow work item being replayed. */
  readonly work: WorkItem;
  /** Runtime-owned flow snapshot loaded before replay. */
  readonly snapshot: RuntimeFlowSnapshot;
  /** Fingerprint checker for deploy-drift detection. */
  readonly fingerprint: ReplayFingerprint;
  /** Delivered event payloads keyed by source-order suspend occurrence. */
  readonly deliveredPayloads: ReadonlyMap<string, JsonValue>;
  /** Buffered defer/after intents waiting for the next durable barrier. */
  readonly scheduledWork: RuntimeScheduledWorkIntent[];
  /** Kernel outcome produced by the flow executor. */
  outcome?: RuntimeTargetOutcome;
}

/** Rotate retry-owned Flow state without disturbing its delivered bindings. @internal */
export function runtimeFlowRetrySnapshot(
  execution: RuntimeFlowExecution,
  options: {
    readonly completedSteps: Record<
      string,
      { readonly output: JsonValue; readonly durationMs: number }
    >;
    readonly continuation: JsonValue;
  },
): RuntimeFlowSnapshot {
  return {
    ...execution.snapshot,
    completedSteps: runtimeCompletedSteps(options.completedSteps),
    fingerprint: execution.fingerprint.observed,
    continuation: options.continuation,
    updatedAt: execution.runtime.now(),
  };
}

/** Shared state between a resolved runtime and its flow target closure. */
export interface RuntimeFlowTargetRef {
  /** Resolved runtime instance. */
  current?: ResolvedRuntimeEngine;
  /** Object-bound run/resume options used while delivering an inline wake. */
  executionOptions?: FlowResumeOptions;
  /** Typed flow result observed during inline object-bound execution. */
  flowResult?: FlowResult<unknown>;
  /** Handler error observed during inline object-bound execution. */
  error?: unknown;
}

/** Convert a runtime snapshot's output-only step cache into object-bound executor cache records. */
export function completedStepsFromRuntimeSnapshot(
  snapshot: RuntimeFlowSnapshot,
): Record<string, { output: JsonValue; durationMs: number }> {
  const completedSteps: Record<
    string,
    { output: JsonValue; durationMs: number }
  > = {};
  for (const [label, output] of Object.entries(snapshot.completedSteps)) {
    completedSteps[label] = {
      output: flowOutputForPersistence(output, `step "${label}" output`),
      durationMs: 0,
    };
  }
  return completedSteps;
}

/** Convert object-bound executor cache records into the runtime snapshot shape. */
export function runtimeCompletedSteps(
  completedSteps: Record<string, { output: JsonValue; durationMs: number }>,
): Record<string, JsonValue> {
  const runtimeSteps: Record<string, JsonValue> = {};
  for (const [label, completed] of Object.entries(completedSteps)) {
    runtimeSteps[label] = flowOutputForPersistence(
      completed.output,
      `step "${label}" output`,
    );
  }
  return runtimeSteps;
}

/** Normalize a flow input for the runtime's JSON-only snapshot boundary. */
export function runtimeInputValue(input: unknown): JsonValue {
  if (input === undefined) return null;
  return flowValueForPersistence(input, { boundary: "flow input" });
}

/** Normalize one defer/after task input before it enters a durable intent. */
export function runtimeScheduledWorkInput(
  input: unknown,
  path: string,
): JsonValue {
  return flowValueForPersistence(input, {
    boundary: "scheduled work input",
    path,
  });
}

/** Sanitize occurrence-keyed delivered payloads before snapshot persistence. */
export function runtimeDeliveredSuspendsForPersistence(
  deliveredSuspends: RuntimeDeliveredSuspends | undefined,
): RuntimeDeliveredSuspends | undefined {
  if (!deliveredSuspends) return undefined;
  const persisted: Record<string, RuntimeDeliveredSuspend> = {};
  for (const [deliveryKey, delivery] of Object.entries(deliveredSuspends)) {
    if (!delivery) continue;
    persisted[deliveryKey] = {
      eventId: delivery.eventId,
      payload: flowValueForPersistence(delivery.payload, {
        boundary: "signal payload",
        path: `$.deliveredSuspends[${JSON.stringify(deliveryKey)}].payload`,
      }),
    };
  }
  return persisted;
}

/** Build a runtime-owned flow snapshot from the current executor state. */
export function runtimeFlowSnapshot(
  execution: RuntimeFlowExecution,
  options: {
    readonly status: RuntimeFlowSnapshot["status"];
    readonly effects: EffectScopeRef;
    readonly input: unknown;
    readonly completedSteps: Record<
      string,
      { output: JsonValue; durationMs: number }
    >;
    readonly continuation?: JsonValue;
    readonly scheduledWork?: RuntimeFlowSnapshot["scheduledWork"];
  },
): RuntimeFlowSnapshot {
  return {
    flowId: execution.snapshot.flowId,
    workId: execution.work.workId,
    targetId: execution.work.targetId,
    namespace: execution.work.namespace,
    status: options.status,
    effects: options.effects,
    input: runtimeInputValue(options.input),
    ...(options.continuation ? { continuation: options.continuation } : {}),
    completedSteps: runtimeCompletedSteps(options.completedSteps),
    fingerprint: execution.fingerprint.observed,
    pendingSuspends: [],
    deliveredSuspends: runtimeDeliveredSuspendsForPersistence(
      execution.snapshot.deliveredSuspends,
    ),
    scheduledWork:
      options.scheduledWork ?? execution.snapshot.scheduledWork ?? {},
    updatedAt: execution.runtime.now(),
  };
}

/** Return the flow id carried by runtime work that is valid for a flow target. */
export function flowIdForRuntimeWork(work: WorkItem): RuntimeFlowId {
  switch (work.work.kind) {
    case "flow.resume":
    case "flow.timeout":
      return work.work.flowId;
    case "task.run":
    case "watch.deliver":
      throw new Error(
        `Runtime target \`${work.targetId}\` received non-flow work \`${work.work.kind}\`.`,
      );
  }
}

/** Whether the current Runtime wake owns expiry for this exact suspend point. */
export function runtimeTimeoutMatches(
  execution: RuntimeFlowExecution,
  suspendPoint: string,
): boolean {
  return (
    execution.work.work.kind === "flow.timeout" &&
    execution.work.work.suspendPoint === suspendPoint
  );
}

/** Select normal or timeout replay for the first due undelivered occurrence. */
export function runtimeResumeWork(
  snapshot: RuntimeFlowSnapshot,
  now: Date,
): RuntimeWork {
  const due = snapshot.pendingSuspends.find((suspend) => {
    const deliveryKey = suspend.deliveryKey ?? suspend.label;
    const delivered =
      suspend.delivered ?? snapshot.deliveredSuspends?.[deliveryKey];
    return (
      delivered === undefined &&
      suspend.timeoutAt !== undefined &&
      suspend.timeoutAt.getTime() <= now.getTime()
    );
  });
  return due
    ? {
        kind: "flow.timeout",
        flowId: snapshot.flowId,
        suspendPoint: due.label,
      }
    : { kind: "flow.resume", flowId: snapshot.flowId };
}

/** Load delivered suspend payloads from the runtime snapshot only. */
export async function deliveredRuntimePayloads(
  _runtime: ResolvedRuntimeEngine,
  snapshot: RuntimeFlowSnapshot,
): Promise<ReadonlyMap<string, JsonValue>> {
  const delivered = new Map<string, JsonValue>();
  for (const [deliveryKey, delivery] of Object.entries(
    snapshot.deliveredSuspends ?? {},
  )) {
    if (!delivery) continue;
    delivered.set(deliveryKey, deliveredPayload(delivery, deliveryKey));
  }
  for (const suspend of snapshot.pendingSuspends) {
    const selected = suspend.candidates?.[0] ?? suspend.delivered;
    if (!selected) continue;
    const deliveryKey = suspend.deliveryKey ?? suspend.label;
    delivered.set(deliveryKey, deliveredPayload(selected, deliveryKey));
  }
  return delivered;
}

let runtimeWorkCounter = 0;

/** Generate a local runtime work id for object-bound in-process flow starts. */
export function runtimeWorkId(): WorkId {
  runtimeWorkCounter += 1;
  return `work_${Date.now().toString(36)}_${runtimeWorkCounter}_${Math.random().toString(36).slice(2, 8)}` as WorkId;
}

/** Return the work id generator shape expected by `createRuntime()`. */
export function createRuntimeWorkIdGenerator(): () => WorkId {
  return runtimeWorkId;
}

/** Build a unique event id for object-bound `FlowHandle.signal()` deliveries. */
export function runtimeSignalEventId(
  flowId: string,
  signalName: string,
): string {
  runtimeWorkCounter += 1;
  return `signal:${flowId}:${signalName}:${Date.now().toString(36)}:${runtimeWorkCounter}`;
}

function deliveredPayload(
  delivery: RuntimeDeliveredSuspend,
  deliveryKey: string,
): JsonValue {
  const payload = (
    delivery as RuntimeDeliveredSuspend & { readonly payload?: JsonValue }
  ).payload;
  if (payload !== undefined) {
    return flowValueForPersistence(payload, {
      boundary: "signal payload",
      path: `$.deliveredSuspends[${JSON.stringify(deliveryKey)}].payload`,
    });
  }
  throw createRuntimeError({
    code: "REPLAY_DIVERGED",
    whatFailed: `Runtime flow replay could not load delivered payload for suspend \`${deliveryKey}\`.`,
    why: "The stored flow snapshot predates runtime payload embedding.",
    whatStillWorks:
      "New runtime-backed flows and newly delivered suspends can replay without reading the event log.",
    nextStep:
      "Restart this flow so its delivered suspend payloads are written into the runtime snapshot.",
  });
}
