/** Canonical public-shape projection of retained process-local Agent Work. */

import type { EffectScopeRef } from "../../effect";
import type { CancelOptions, CancelReceipt } from "../cancellation";
import type { DetachReceipt } from "../detachment";
import type { WorkOwnership, WorkStatus } from "../status";
import type {
  InternalRetainedWorkReference,
  InternalWorkOwnerPort,
} from "./owner-retained-work";
import type {
  InternalWorkHandle,
  InternalWorkStatus,
} from "./process-local-kernel";

/** Canonical base behavior supported by one retained process-local child. */
export interface ProcessLocalWorkProjection<TOutput> {
  readonly id: string;
  readonly targetId: string;
  readonly effects: EffectScopeRef;
  status(): Promise<WorkStatus>;
  result(): Promise<TOutput>;
  cancel(options?: CancelOptions): Promise<CancelReceipt>;
  detach(): Promise<DetachReceipt>;
}

/**
 * Project one owner's retained Agent child without exposing its private inbox.
 *
 * @remarks This pre-existing process-local projection retains its private
 * target metadata, while lifecycle, control receipts, and safe summaries use
 * the shared public Work contracts. It does not provide durable persistence.
 * @internal
 */
export function projectProcessLocalWork<TOutput>(
  owner: InternalWorkOwnerPort,
  reference: InternalRetainedWorkReference<TOutput>,
): ProcessLocalWorkProjection<TOutput> | undefined {
  const handle = owner.recover(reference);
  const owned = owner.inspect(reference.id);
  if (!handle || !owned) return undefined;
  let ownership: WorkOwnership = Object.freeze({ state: "attached" });

  return Object.freeze({
    id: handle.id,
    targetId: owned.targetId,
    effects: handle.effects,
    status: () => projectStatus(handle, ownership),
    result: () => handle.result(),
    cancel: async (options?: CancelOptions) => {
      const cancelled = handle.cancel();
      if (cancelled) await handle.result().catch(() => undefined);
      const status = await projectStatus(handle, ownership, options?.reason);
      return Object.freeze({
        workId: handle.id,
        outcome: cancelled ? "cancelled" : "already-terminal",
        status: terminalStatus(status),
      });
    },
    detach: async () => {
      const detached = owner.detach(handle.id);
      if (detached) {
        ownership = Object.freeze({
          state: "detached",
          reason: "explicit",
          detachedAt: new Date(),
        });
      }
      const status = await projectStatus(handle, ownership);
      return Object.freeze({
        workId: handle.id,
        outcome: detached
          ? "detached"
          : status.state === "completed" ||
              status.state === "failed" ||
              status.state === "cancelled"
            ? "already-terminal"
            : "already-detached",
        ownership,
      });
    },
  });
}

async function projectStatus<TOutput>(
  handle: InternalWorkHandle<TOutput>,
  ownership: WorkOwnership,
  reason?: string,
): Promise<WorkStatus> {
  const status = await handle.status();
  const base = { id: status.id, ownership, updatedAt: status.updatedAt };

  switch (status.state) {
    case "queued":
      return Object.freeze({ ...base, state: "queued", acceptedAt: status.acceptedAt });
    case "running":
    case "cancel-requested":
      return Object.freeze({ ...base, state: "running", startedAt: status.startedAt });
    case "completed":
      return Object.freeze({
        ...base,
        state: "completed",
        completedAt: status.completedAt,
        resultAvailable: status.resultAvailable,
      });
    case "failed":
      return failedStatus(base, status);
    case "cancelled":
      return Object.freeze({
        ...base,
        state: "cancelled",
        cancelledAt: status.cancelledAt,
        ...(reason ? { reason } : undefined),
      });
  }
}

function failedStatus(
  base: { readonly id: string; readonly ownership: WorkOwnership; readonly updatedAt: Date },
  status: Extract<InternalWorkStatus, { readonly state: "failed" }>,
): WorkStatus {
  return Object.freeze({
    ...base,
    state: "failed",
    failedAt: status.failedAt,
    failure: Object.freeze({
      code: "process_local_failure",
      message: "Process-local Work failed.",
      retryable: false,
    }),
  });
}

function terminalStatus(status: WorkStatus): Extract<
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
  throw new Error("Process-local Work cancellation did not terminalize.");
}
