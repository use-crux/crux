/**
 * Isolated process-local registry and lifecycle for internal Work execution.
 *
 * @internal
 * @module
 */

import type { EffectScopeRef } from "../../effect/types";
import { runPassiveEffectBoundary } from "../../effect/internal/boundary";
import {
  createInternalWorkCancellation,
  currentInternalWorkAttachment,
  runWithInternalWorkContext,
  type InternalWorkSpawnOptions,
} from "./attached-context";
import type {
  InternalWorkExecutionContext,
  InternalWorkTargetDriver,
} from "./target-driver";
import {
  workStatusSnapshot,
  type InternalWorkStatus,
  type StoredWorkStatus,
} from "./process-local-status";

export type { InternalWorkStatus } from "./process-local-status";

/** Typed internal handle for one finite process-local execution. @internal */
export interface InternalWorkHandle<TOutput> {
  /** Stable process-local Work identity. */
  readonly id: string;
  /** Stable passive Effect boundary containing this execution. */
  readonly effects: EffectScopeRef;
  /** Read the current minimal lifecycle snapshot. */
  status(): Promise<InternalWorkStatus>;
  /** Join the execution and return its exact target output. */
  result(): Promise<TOutput>;
  /** Cooperatively request cancellation of this Work occurrence. */
  cancel(): boolean;
}

/** Injectable process-local infrastructure seams. @internal */
export interface ProcessLocalWorkKernelOptions {
  /** Allocate one Work identity. */
  readonly createId?: () => string;
  /** Read the current wall-clock time. */
  readonly now?: () => Date;
  /** Schedule an accepted execution to start. */
  readonly schedule?: (start: () => void) => void;
  /** Run the passive Effect boundary; injectable for internal failure tests. */
  readonly runEffectBoundary?: typeof runPassiveEffectBoundary;
}

/** Explicitly instantiated, isolated Work registry and execution kernel. @internal */
export interface ProcessLocalWorkKernel {
  /** Accept and schedule one bound target with explicit optional linkage. */
  spawn<TOutput>(
    driver: InternalWorkTargetDriver<TOutput>,
    options?: InternalWorkSpawnOptions,
  ): Promise<InternalWorkHandle<TOutput>>;
}

interface MutableWorkRecord {
  status: StoredWorkStatus;
}

/** Whether a stored status awaits acknowledgement of a direct cancellation. */
function isCancellationRequested(status: StoredWorkStatus): boolean {
  return status.state === "cancel-requested";
}


/**
 * Create an isolated process-local Work kernel.
 *
 * @remarks Each instance owns its registry. Target execution enters through a
 * non-public first-party driver and runs inside the supported passive Effect
 * boundary. No state or target registration is global.
 *
 * @param options - Optional deterministic process-local infrastructure.
 * @returns A kernel that accepts one finite execution per `spawn()` call.
 *
 * @internal
 */
export function createProcessLocalWorkKernel(
  options: ProcessLocalWorkKernelOptions = {},
): ProcessLocalWorkKernel {
  const registry = new Map<string, MutableWorkRecord>();
  const now = options.now ?? (() => new Date());
  const schedule = options.schedule ?? queueMicrotask;
  const runEffectBoundary =
    options.runEffectBoundary ?? runPassiveEffectBoundary;
  let nextId = 0;
  const createId =
    options.createId ??
    (() => {
      nextId += 1;
      return `work_${Date.now().toString(36)}_${nextId.toString(36)}`;
    });

  return Object.freeze({
    async spawn<TOutput>(
      driver: InternalWorkTargetDriver<TOutput>,
      options?: InternalWorkSpawnOptions,
    ): Promise<InternalWorkHandle<TOutput>> {
      const attachment =
        options?.kind === "attached"
          ? options.attachment
          : options
            ? undefined
            : currentInternalWorkAttachment();
      const parentSignal =
        options?.kind === "cancellation-only"
          ? options.signal
          : attachment?.signal;
      const id = createId();
      if (registry.has(id)) {
        throw new TypeError(`Process-local Work id \`${id}\` already exists.`);
      }
      const acceptedAt = now().getTime();
      const record: MutableWorkRecord = {
        status: Object.freeze({
          id,
          state: "queued",
          acceptedAt,
          updatedAt: acceptedAt,
        }),
      };
      registry.set(id, record);
      const cancellation = createInternalWorkCancellation(parentSignal);

      let acceptEffects!: (effects: EffectScopeRef) => void;
      const effectsAllocated = new Promise<EffectScopeRef>((resolve) => {
        acceptEffects = resolve;
      });
      let start!: () => void;
      const scheduled = new Promise<void>((resolve) => {
        start = resolve;
      });
      const execution = runEffectBoundary(
        id,
        async (boundary) => {
          acceptEffects(boundary.ref);
          schedule(start);
          await scheduled;

          if (record.status.state === "cancelled") {
            throw cancellation.signal.reason;
          }

          const startedAt = now().getTime();
          record.status = Object.freeze({
            id,
            state: "running",
            acceptedAt,
            startedAt,
            updatedAt: startedAt,
          });
          const context: InternalWorkExecutionContext = Object.freeze({
            id,
            ...(attachment ? { attachedParentId: attachment.parentId } : undefined),
            signal: cancellation.signal,
            effects: boundary.ref,
          });
          let output: TOutput;
          try {
            output = await runWithInternalWorkContext(
              id,
              cancellation.signal,
              () => driver.run(context),
            );
          } catch (failure) {
            const failedAt = now().getTime();
            if (
              isCancellationRequested(record.status) &&
              cancellation.signal.aborted &&
              failure === cancellation.signal.reason
            ) {
              record.status = Object.freeze({
                id,
                state: "cancelled",
                acceptedAt,
                startedAt,
                cancelledAt: failedAt,
                updatedAt: failedAt,
              });
              throw failure;
            }
            record.status = Object.freeze({
              id,
              state: "failed",
              acceptedAt,
              startedAt,
              failedAt,
              updatedAt: failedAt,
            });
            throw failure;
          }
          const completedAt = now().getTime();
          record.status = Object.freeze({
            id,
            state: "completed",
            acceptedAt,
            startedAt,
            completedAt,
            resultAvailable: true,
            updatedAt: completedAt,
          });
          return output;
        },
        undefined,
        options &&
          "effectParent" in options &&
          options.effectParent === "independent"
          ? { effectParent: "independent" }
          : undefined,
      );
      void execution.then(cancellation.dispose, cancellation.dispose);
      void execution.catch(() => undefined);
      let effects: EffectScopeRef;
      try {
        effects = await Promise.race([
          effectsAllocated,
          execution.then(() => effectsAllocated),
        ]);
      } catch (failure) {
        registry.delete(id);
        throw failure;
      }

      return Object.freeze({
        id,
        effects,
        status: () => Promise.resolve(workStatusSnapshot(record.status)),
        result: () => execution,
        cancel: () => {
          const current = record.status;
          const updatedAt = now().getTime();
          switch (current.state) {
            case "queued":
              record.status = Object.freeze({
                id,
                state: "cancelled",
                acceptedAt,
                cancelledAt: updatedAt,
                updatedAt,
              });
              cancellation.cancel();
              return true;
            case "running":
              record.status = Object.freeze({
                id,
                state: "cancel-requested",
                acceptedAt,
                startedAt: current.startedAt,
                cancellationRequestedAt: updatedAt,
                updatedAt,
              });
              cancellation.cancel();
              return true;
            case "cancel-requested":
            case "completed":
            case "failed":
            case "cancelled":
              return false;
          }
        },
      });
    },
  });
}
