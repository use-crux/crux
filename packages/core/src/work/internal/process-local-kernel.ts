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

interface InternalWorkStatusBase {
  readonly id: string;
  readonly acceptedAt: Date;
  readonly updatedAt: Date;
}

/** Minimal lifecycle exposed by the first internal Work tracer. @internal */
export type InternalWorkStatus =
  | (InternalWorkStatusBase & { readonly state: "queued" })
  | (InternalWorkStatusBase & {
      readonly state: "running";
      readonly startedAt: Date;
    })
  | (InternalWorkStatusBase & {
      readonly state: "completed";
      readonly startedAt: Date;
      readonly completedAt: Date;
      readonly resultAvailable: true;
    })
  | (InternalWorkStatusBase & {
      readonly state: "failed";
      readonly startedAt: Date;
      readonly failedAt: Date;
    });

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
  cancel(): void;
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

interface StoredWorkStatusBase {
  readonly id: string;
  readonly acceptedAt: number;
  readonly updatedAt: number;
}

type StoredWorkStatus =
  | (StoredWorkStatusBase & { readonly state: "queued" })
  | (StoredWorkStatusBase & {
      readonly state: "running";
      readonly startedAt: number;
    })
  | (StoredWorkStatusBase & {
      readonly state: "completed";
      readonly startedAt: number;
      readonly completedAt: number;
      readonly resultAvailable: true;
    })
  | (StoredWorkStatusBase & {
      readonly state: "failed";
      readonly startedAt: number;
      readonly failedAt: number;
    });

interface MutableWorkRecord {
  status: StoredWorkStatus;
}

/** Materialize a detached lifecycle snapshot from immutable timestamps. */
function workStatusSnapshot(status: StoredWorkStatus): InternalWorkStatus {
  const base = {
    id: status.id,
    acceptedAt: new Date(status.acceptedAt),
    updatedAt: new Date(status.updatedAt),
  };

  switch (status.state) {
    case "queued":
      return Object.freeze({ ...base, state: status.state });
    case "running":
      return Object.freeze({
        ...base,
        state: status.state,
        startedAt: new Date(status.startedAt),
      });
    case "completed":
      return Object.freeze({
        ...base,
        state: status.state,
        startedAt: new Date(status.startedAt),
        completedAt: new Date(status.completedAt),
        resultAvailable: status.resultAvailable,
      });
    case "failed":
      return Object.freeze({
        ...base,
        state: status.state,
        startedAt: new Date(status.startedAt),
        failedAt: new Date(status.failedAt),
      });
  }
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
        cancel: cancellation.cancel,
      });
    },
  });
}
