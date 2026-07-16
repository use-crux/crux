/** Score-aware assertion phase kept separate from task/scorer execution. @internal */

import type { AssertContext } from "../../quality/expect";
import type { Capability } from "../../quality/target";
import {
  createAssertionRecorder,
  createRuntimeBoundExpect,
  createStepAccessor,
} from "../../quality/internal/expect-runtime";
import { scoreMapFromScores } from "../../quality/internal/score-map";
import type { CellSignals } from "../../quality/internal/signals";
import type {
  EvalPlannedCell,
  EvalScoreEvidence,
  EvalTaskExecutionEvidence,
} from "./types";
import type { NormalizedEvalCheck } from "./definition";
import {
  createEvalMeta,
  guardEvalExpect,
  guardEvalStepAccessor,
  runNormalizedEvalChecks,
} from "./check-runtime";

/** Run evaluation- and Case-level post-score assertions in authored order. */
export function runAfterScoreAssertions(input: {
  readonly planAfterScores?: NormalizedEvalCheck;
  readonly cell: EvalPlannedCell;
  readonly execution: EvalTaskExecutionEvidence;
  readonly scores: readonly EvalScoreEvidence[];
  readonly signals: CellSignals;
  readonly recorder: ReturnType<typeof createAssertionRecorder>;
  readonly managedTask: boolean;
}) {
  const cellScores = input.scores.flatMap((entry) =>
    entry.status === "computed"
      ? [
          {
            name: entry.name,
            score: entry.value,
            ...(entry.label !== undefined ? { label: entry.label } : {}),
          },
        ]
      : [],
  );
  const createContext = (
    requiresFresh: boolean,
    activeRecorder: ReturnType<typeof createAssertionRecorder>,
  ): AssertContext<unknown, unknown, unknown, string, Capability> => ({
    input: input.cell.input,
    output: input.execution.output,
    ...(input.managedTask ? { response: input.execution.response } : {}),
    expected: input.cell.expected,
    expect: guardEvalExpect(
      createRuntimeBoundExpect({
        signals: input.signals,
        recorder: activeRecorder,
        capabilities: input.execution.capturedSignals,
        cellDurationMs: () => input.execution.metrics.durationMs,
        cellErrored: () => false,
      }),
      requiresFresh,
    ),
    score: scoreMapFromScores(cellScores),
    scores: cellScores,
    variant: { name: input.cell.variant, params: input.cell.overrides },
    trial: input.cell.trial,
    step: guardEvalStepAccessor(
      createStepAccessor(input.signals),
      requiresFresh,
    ) as never,
    trace: { id: input.execution.runIds[0] },
    meta: createEvalMeta(
      input.execution.metrics.durationMs,
      input.execution.metrics.costUsd,
      requiresFresh,
    ),
  });
  return runNormalizedEvalChecks({
    checks: [
      { declaration: input.planAfterScores, level: "evaluation" },
      { declaration: input.cell.afterScores, level: "case" },
    ],
    phase: "afterScores",
    recorder: input.recorder,
    createContext,
  });
}
