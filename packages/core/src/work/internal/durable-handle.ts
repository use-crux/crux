/** Runtime-backed projection of one durable Work occurrence. */

import type { EffectScopeRef } from "../../effect";
import type { ResolvedRuntimeEngine } from "../../runtime/api/create-runtime";
import { createRuntimeError } from "../../runtime/engine/errors";
import type { RuntimeWorkItem } from "../../runtime/engine/work";
import type { FlowSnapshot } from "../../runtime/ports/state";
import type { WorkHandle } from "../handle";
import type { CancelReceipt } from "../cancellation";
import type { DetachReceipt } from "../detachment";
import type { ExecutionStats } from "../handle";
import type { WorkStatus } from "../status";

/** Project durable Runtime records into the canonical public Work handle. */
export function durableWorkHandle<TResult>(
  runtime: ResolvedRuntimeEngine,
  work: RuntimeWorkItem,
  snapshot: FlowSnapshot,
): WorkHandle<TResult> {
  const id = work.workId;
  if (!snapshot.effects) throw retainedWorkMissing(id);
  const effects: EffectScopeRef = Object.freeze({
    kind: snapshot.effects.kind,
    id: snapshot.effects.id,
    runId: snapshot.effects.runId,
  });
  const status = async () => {
    const current = await runtime.store.state.getWork(id, {
      namespace: runtime.namespace,
    });
    if (!current) throw retainedWorkMissing(id);
    return publicStatus(current);
  };

  return Object.freeze({
    id,
    effects,
    status,
    result: () => unavailable<TResult>("result()", id),
    progress: () => unavailable<void>("progress()", id),
    cancel: () => unavailable<CancelReceipt>("cancel()", id),
    detach: () => unavailable<DetachReceipt>("detach()", id),
    stream: async function* () {
      const current = await status();
      yield Object.freeze({
        id: `${id}:snapshot`,
        cursor: "snapshot",
        workId: id,
        occurredAt: current.updatedAt,
        type: "work.snapshot" as const,
        status: current,
      });
    },
    stats: () => unavailable<ExecutionStats>("stats()", id),
  });
}

function publicStatus(work: RuntimeWorkItem): WorkStatus {
  const base = Object.freeze({
    id: work.workId,
    ownership: Object.freeze({ state: "attached" as const }),
    updatedAt: new Date(work.updatedAt),
  });
  switch (work.status) {
    case "pending":
      return Object.freeze({
        ...base,
        state: "queued",
        acceptedAt: new Date(work.createdAt),
      });
    case "leased":
      return Object.freeze({
        ...base,
        state: "running",
        startedAt: new Date(work.updatedAt),
      });
    case "suspended":
      return Object.freeze({
        ...base,
        state: "suspended",
        suspendedOn: Object.freeze({ kind: "other" }),
      });
    case "blocked":
      return Object.freeze({
        ...base,
        state: "blocked",
        blockedOn: Object.freeze({
          kind: "other",
          code: work.lastError?.code ?? "work_blocked",
          message: work.lastError?.message ?? "Work is blocked.",
        }),
      });
    case "dead-letter":
      return Object.freeze({
        ...base,
        state: "failed",
        failedAt: new Date(work.updatedAt),
        failure: Object.freeze({
          code: work.lastError?.code ?? "work_failed",
          message: work.lastError?.message ?? "Work failed.",
          retryable: false,
        }),
      });
    case "completed":
      return Object.freeze({
        ...base,
        state: "completed",
        completedAt: new Date(work.updatedAt),
        resultAvailable: work.resultRef !== undefined,
      });
    case "cancelled":
      return Object.freeze({
        ...base,
        state: "cancelled",
        cancelledAt: new Date(work.updatedAt),
      });
  }
}

function unavailable<TResult>(api: string, id: string): Promise<TResult> {
  return Promise.reject(
    createRuntimeError({
      code: "CAPABILITY_MISSING",
      whatFailed: `${api} is not available for durable Work \`${id}\` in this runtime slice.`,
      why: "This host currently provides durable admission, status, and reconnection only.",
      whatStillWorks: "The Work remains durably queued and reconnectable.",
      nextStep:
        "Use status() until the durable control and result slice is installed.",
    }),
  );
}

function retainedWorkMissing(id: string): Error {
  return createRuntimeError({
    code: "TARGET_NOT_FOUND",
    whatFailed: `Work \`${id}\` is no longer retained.`,
    why: "Its Runtime control record is absent from the configured namespace.",
    whatStillWorks: "Other retained Work occurrences remain readable.",
    nextStep: "Check the retention policy before reconnecting this Work.",
  });
}
