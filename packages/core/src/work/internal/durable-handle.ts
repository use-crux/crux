/** Runtime-backed projection of one durable Work occurrence. */

import type { EffectScopeRef } from "../../effect";
import type { ResolvedRuntimeEngine } from "../../runtime/api/create-runtime";
import type { RuntimeWorkItem } from "../../runtime/engine/work";
import type { FlowSnapshot } from "../../runtime/ports/state";
import type { WorkId } from "../../runtime/ports/ids";
import type { WorkHandle } from "../handle";
import type { CancelOptions, CancelReceipt } from "../cancellation";
import type { DetachReceipt } from "../detachment";
import type { ExecutionStats } from "../handle";
import type { WorkStatus } from "../status";
import { durableWorkResult } from "./durable-result";
import { WorkNotActiveError } from "../errors";
import type { WorkProgress } from "../progress";
import { applicationWorkStatistics } from "../../runtime/engine/application-work-statistics";
import type { WorkStreamOptions } from "../events";
import { durableWorkStatus } from "./durable-status";
import { durableWorkStream } from "./durable-stream";
import { retainedWorkMissing } from "./durable-errors";

/** Project durable Runtime records into the canonical public Work handle. */
export function durableWorkHandle<TResult>(
  runtime: ResolvedRuntimeEngine,
  work: RuntimeWorkItem,
  snapshot?: FlowSnapshot,
): WorkHandle<TResult> {
  const id = work.workId;
  const retainedEffects = work.application?.effects ?? snapshot?.effects;
  if (!retainedEffects) throw retainedWorkMissing(id);
  const effects: EffectScopeRef = Object.freeze({
    kind: retainedEffects.kind,
    id: retainedEffects.id,
    runId: retainedEffects.runId,
  });
  const status = async () => {
    const current = await runtime.store.state.getWork(id, {
      namespace: runtime.namespace,
    });
    if (!current) throw retainedWorkMissing(id);
    return durableWorkStatus(current);
  };

  return Object.freeze({
    id,
    effects,
    status,
    result: () => durableWorkResult<TResult>(runtime, work.workId),
    progress: (update: WorkProgress) => updateProgress(runtime, id, update),
    cancel: (options?: CancelOptions) => cancelWork(runtime, id, options),
    detach: () => detachWork(runtime, id),
    stream: (options?: WorkStreamOptions) =>
      durableWorkStream(runtime, id, options),
    stats: () => readStatistics(runtime, id),
  });
}

async function readStatistics(
  runtime: ResolvedRuntimeEngine,
  id: WorkId,
): Promise<ExecutionStats> {
  const current = await runtime.store.state.getWork(id, {
    namespace: runtime.namespace,
  });
  if (!current) throw retainedWorkMissing(id);
  return applicationWorkStatistics(
    current.application,
    current.workId,
    current.createdAt,
  );
}

async function detachWork(
  runtime: ResolvedRuntimeEngine,
  id: WorkId,
): Promise<DetachReceipt> {
  const result = await runtime.kernel.detachWork({
    namespace: runtime.namespace,
    workId: id,
  });
  if (result.outcome === "not-found") throw retainedWorkMissing(id);
  return Object.freeze({
    workId: id,
    outcome: result.outcome,
    ownership: durableWorkStatus(result.work).ownership,
  });
}

async function cancelWork(
  runtime: ResolvedRuntimeEngine,
  id: WorkId,
  options?: CancelOptions,
): Promise<CancelReceipt> {
  const reason = validatedCancellationReason(options?.reason);
  const result = await runtime.kernel.cancelWork({
    namespace: runtime.namespace,
    workId: id,
    ...(reason === undefined ? {} : { reason }),
  });
  const current = await runtime.store.state.getWork(id, {
    namespace: runtime.namespace,
  });
  if (!current) throw retainedWorkMissing(id);
  const status = terminalStatus(durableWorkStatus(current));
  return Object.freeze({
    workId: id,
    outcome: result.cancelled ? "cancelled" : "already-terminal",
    status,
  });
}

function validatedCancellationReason(
  reason: string | undefined,
): string | undefined {
  if (reason === undefined) return undefined;
  if (typeof reason !== "string" || reason.length > 512) {
    throw new TypeError(
      "Work cancellation reason must be at most 512 characters.",
    );
  }
  return reason;
}

function terminalStatus(
  status: WorkStatus,
): Extract<
  WorkStatus,
  { readonly state: "completed" | "failed" | "cancelled" }
> {
  if (
    status.state === "completed" ||
    status.state === "failed" ||
    status.state === "cancelled"
  ) {
    return status;
  }
  throw new Error("Work cancellation did not reach a terminal state.");
}

async function updateProgress(
  runtime: ResolvedRuntimeEngine,
  id: WorkId,
  update: WorkProgress,
): Promise<void> {
  const progress = validatedProgress(update);
  const result = await runtime.kernel.progressWork({
    namespace: runtime.namespace,
    workId: id,
    progress,
  });
  if (result.outcome === "already-terminal") throw new WorkNotActiveError(id);
  if (result.outcome === "not-found") throw retainedWorkMissing(id);
}

function validatedProgress(update: WorkProgress): WorkProgress {
  if (!update || typeof update !== "object" || Array.isArray(update)) {
    throw new TypeError("Work progress must be an object.");
  }
  const message = update.message;
  if (
    message !== undefined &&
    (typeof message !== "string" || message.length > 1_024)
  ) {
    throw new TypeError(
      "Work progress message must be at most 1024 characters.",
    );
  }
  const current = progressNumber(update.current, "current");
  const total = progressNumber(update.total, "total");
  if (current !== undefined && total !== undefined && current > total) {
    throw new TypeError("Work progress current must not exceed total.");
  }
  return Object.freeze({
    ...(message === undefined ? {} : { message }),
    ...(current === undefined ? {} : { current }),
    ...(total === undefined ? {} : { total }),
  });
}

function progressNumber(
  value: number | undefined,
  name: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(
      `Work progress ${name} must be a non-negative finite number.`,
    );
  }
  return value;
}
