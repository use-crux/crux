/** Declared Eval-check execution and timing-evidence runtime backstops. @internal */

import type { StepAccess, StepAccessor } from "../../quality/expect";
import type { CellAssertionPhase } from "../../quality/experiment";
import type { StandardSchemaV1 } from "../../quality/standard-schema";
import { runAssertionCallbacks } from "../../quality/internal/assertion-callbacks";
import type { AssertionRecorder } from "../../quality/internal/expect-runtime";
import type { NormalizedEvalCheck } from "./definition";

export const PERFORMANCE_EVIDENCE_GUIDANCE =
  "Performance evidence requires a live check. Use gates.latency for normal thresholds, or expect: { fresh: true, check: (...) => ... } for custom logic.";

/** Run normalized callbacks with the timing surface selected by declaration. */
export async function runNormalizedEvalChecks<TContext>(input: {
  readonly checks: readonly {
    readonly declaration?: NormalizedEvalCheck;
    readonly level: "evaluation" | "case";
  }[];
  readonly phase: CellAssertionPhase;
  readonly recorder: AssertionRecorder;
  readonly createContext: (
    requiresFresh: boolean,
    recorder: AssertionRecorder,
  ) => TContext;
}) {
  let notEvaluated = 0;
  for (const { declaration, level } of input.checks) {
    if (declaration === undefined) continue;
    const result = await runAssertionCallbacks({
      callbacks: [
        {
          phase: input.phase,
          level,
          fn: declaration.check as (context: TContext) => void | Promise<void>,
        },
      ],
      context: input.createContext(declaration.requiresFresh, input.recorder),
      recorder: input.recorder,
      createCountingContext: (recorder) =>
        input.createContext(declaration.requiresFresh, recorder),
    });
    notEvaluated += result.notEvaluated;
    if (result.error !== undefined) {
      return { notEvaluated, error: result.error };
    }
  }
  return { notEvaluated };
}

/** Hide timing from ordinary callbacks while retaining an actionable getter. */
export function guardEvalExpect<T extends object>(
  expect: T,
  requiresFresh: boolean,
): T {
  if (!requiresFresh) defineTimingGuard(expect, "latency");
  return expect;
}

/** Construct metadata whose duration is visible only to fresh callbacks. */
export function createEvalMeta(
  durationMs: number,
  costUsd: number | undefined,
  requiresFresh: boolean,
): { readonly durationMs: number; readonly costUsd?: number } {
  const meta: { durationMs?: number; costUsd?: number } = {
    ...(costUsd !== undefined ? { costUsd } : {}),
  };
  if (requiresFresh) meta.durationMs = durationMs;
  else defineTimingGuard(meta, "durationMs");
  return meta as { readonly durationMs: number; readonly costUsd?: number };
}

/** Wrap step access so ordinary callbacks cannot observe cached durations. */
export function guardEvalStepAccessor(
  accessor: StepAccessor,
  requiresFresh: boolean,
): StepAccessor {
  if (requiresFresh) return accessor;
  return ((name: string, schema?: StandardSchemaV1) => {
    const step =
      schema === undefined ? accessor(name) : accessor(name, schema as never);
    const guarded: Omit<StepAccess<unknown>, "durationMs"> & {
      durationMs?: number;
    } = { output: step.output, status: step.status };
    defineTimingGuard(guarded, "durationMs");
    return guarded;
  }) as StepAccessor;
}

function defineTimingGuard(target: object, property: string): void {
  Object.defineProperty(target, property, {
    configurable: false,
    enumerable: false,
    get(): never {
      throw new TypeError(PERFORMANCE_EVIDENCE_GUIDANCE);
    },
  });
}
