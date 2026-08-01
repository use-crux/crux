/**
 * Isolated process-local registry and lifecycle for internal Work execution.
 *
 * @internal
 * @module
 */

import type { EffectScopeRef } from "../../effect/types";
import { runPassiveEffectBoundary } from "../../effect/internal/boundary";
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
}

/** Injectable process-local identity, clock, and scheduling seams. @internal */
export interface ProcessLocalWorkKernelOptions {
  /** Allocate one Work identity. */
  readonly createId?: () => string;
  /** Read the current wall-clock time. */
  readonly now?: () => Date;
  /** Schedule an accepted execution to start. */
  readonly schedule?: (start: () => void) => void;
}

/** Explicitly instantiated, isolated Work registry and execution kernel. @internal */
export interface ProcessLocalWorkKernel {
  /** Accept and schedule one bound first-party target execution. */
  spawn<TOutput>(
    driver: InternalWorkTargetDriver<TOutput>,
  ): Promise<InternalWorkHandle<TOutput>>;
}

interface MutableWorkRecord {
  status: InternalWorkStatus;
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
    ): Promise<InternalWorkHandle<TOutput>> {
      const id = createId();
      if (registry.has(id)) {
        throw new TypeError(`Process-local Work id \`${id}\` already exists.`);
      }
      const acceptedAt = now();
      const record: MutableWorkRecord = {
        status: Object.freeze({
          id,
          state: "queued",
          acceptedAt,
          updatedAt: acceptedAt,
        }),
      };
      registry.set(id, record);

      let acceptEffects!: (effects: EffectScopeRef) => void;
      const effectsAllocated = new Promise<EffectScopeRef>((resolve) => {
        acceptEffects = resolve;
      });
      let start!: () => void;
      const scheduled = new Promise<void>((resolve) => {
        start = resolve;
      });
      const execution = runPassiveEffectBoundary(id, async (boundary) => {
        acceptEffects(boundary.ref);
        schedule(start);
        await scheduled;

        const startedAt = now();
        record.status = Object.freeze({
          id,
          state: "running",
          acceptedAt,
          startedAt,
          updatedAt: startedAt,
        });
        const context: InternalWorkExecutionContext = Object.freeze({
          id,
          effects: boundary.ref,
        });
        const output = await driver.run(context);
        const completedAt = now();
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
      });
      void execution.catch(() => undefined);
      const effects = await effectsAllocated;

      return Object.freeze({
        id,
        effects,
        status: () => Promise.resolve(record.status),
        result: () => execution,
      });
    },
  });
}
