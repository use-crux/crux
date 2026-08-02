/** Canonical public-shape projection of retained process-local Agent Work. */

import type { EffectScopeRef } from "../../effect";
import type {
  CancelOptions,
  CancelReceipt,
  DetachReceipt,
  WorkStatusSnapshot,
} from "../types";
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
  status(): Promise<WorkStatusSnapshot<string, string, TOutput>>;
  result(): Promise<TOutput>;
  cancel(options?: CancelOptions): Promise<CancelReceipt>;
  detach(): Promise<DetachReceipt>;
}

/**
 * Project one owner's retained Agent child without exposing its private inbox.
 *
 * @remarks Detachment removes only the owner's retained reference. The
 * process-local execution and this already-issued projection remain usable.
 *
 * @internal
 */
export function projectProcessLocalWork<TOutput>(
  owner: InternalWorkOwnerPort,
  reference: InternalRetainedWorkReference<TOutput>,
): ProcessLocalWorkProjection<TOutput> | undefined {
  const handle = owner.recover(reference);
  const owned = owner.inspect(reference.id);
  if (!handle || !owned) return undefined;
  const targetId = owned.targetId;

  return Object.freeze({
    id: handle.id,
    targetId,
    effects: handle.effects,
    status: () => projectStatus(handle, targetId),
    result: () => handle.result(),
    cancel: async (_options?: CancelOptions) =>
      Object.freeze({ cancelled: handle.cancel() }),
    detach: async () => Object.freeze({ detached: owner.detach(handle.id) }),
  });
}

async function projectStatus<TOutput>(
  handle: InternalWorkHandle<TOutput>,
  targetId: string,
): Promise<WorkStatusSnapshot<string, string, TOutput>> {
  const status = await handle.status();
  const base = {
    id: status.id,
    targetId,
    acceptedAt: status.acceptedAt,
    updatedAt: status.updatedAt,
  };

  switch (status.state) {
    case "queued":
      return Object.freeze({ ...base, state: status.state });
    case "running":
    case "cancel-requested":
      return Object.freeze({
        ...base,
        state: "running",
        startedAt: status.startedAt,
      });
    case "completed":
      return Object.freeze({
        ...base,
        state: status.state,
        startedAt: status.startedAt,
        completedAt: status.completedAt,
        result: await handle.result(),
      });
    case "failed":
      return failedStatus(base, status, handle);
    case "cancelled":
      return Object.freeze({
        ...base,
        state: status.state,
        ...(status.startedAt ? { startedAt: status.startedAt } : undefined),
        cancelledAt: status.cancelledAt,
      });
  }
}

async function failedStatus<TOutput>(
  base: {
    readonly id: string;
    readonly targetId: string;
    readonly acceptedAt: Date;
    readonly updatedAt: Date;
  },
  status: Extract<InternalWorkStatus, { readonly state: "failed" }>,
  handle: InternalWorkHandle<TOutput>,
): Promise<WorkStatusSnapshot<string, string, TOutput>> {
  let error: unknown;
  try {
    await handle.result();
  } catch (failure) {
    error = failure;
  }
  return Object.freeze({
    ...base,
    state: status.state,
    startedAt: status.startedAt,
    failedAt: status.failedAt,
    error,
  });
}
