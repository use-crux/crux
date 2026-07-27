/** Timed-out Eval cell read-model projection. @internal */

import {
  EMPTY_ASSERTIONS,
  cellIdentity,
  dependencyFailedScores,
  freezeCell,
} from "./cell-result";
import type { EvalCell, EvalCellTimeout, EvalPlannedCell } from "./types";
import type { EvalCellObservationSnapshot } from "./cell-observation";

/** Project one terminal timeout without generic task-error evidence. */
export function createTimedOutEvalCell(input: {
  readonly planned: EvalPlannedCell;
  readonly timeout: EvalCellTimeout;
  readonly durationMs: number;
  readonly observation: EvalCellObservationSnapshot;
}): EvalCell {
  return freezeCell({
    ...cellIdentity(input.planned),
    status: "timed_out",
    task: { status: "timed_out" },
    timeout: input.timeout,
    scores: dependencyFailedScores(input.planned),
    assertions: EMPTY_ASSERTIONS,
    metrics: { durationMs: input.durationMs },
    runIds: input.observation.runIds,
    capturedSignals: input.observation.capturedSignals,
  });
}
