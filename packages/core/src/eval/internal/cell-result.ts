/** Immutable result shaping shared by every Eval-cell execution path. */

import type { EvalAssertionSummary, EvalCell, EvalPlannedCell } from "./types";

export const EMPTY_ASSERTIONS: EvalAssertionSummary = Object.freeze({
  ran: 0,
  notEvaluated: 0,
  outcomes: Object.freeze([]),
});

export function cellIdentity(planned: EvalPlannedCell) {
  return {
    caseId: planned.caseId,
    ...(planned.caseName !== undefined ? { caseName: planned.caseName } : {}),
    variant: planned.variant,
    trial: planned.trial,
    input: planned.input,
    ...(planned.call !== undefined ? { call: planned.call } : {}),
    ...(planned.expected !== undefined ? { expected: planned.expected } : {}),
    ...(planned.unvalidatedExpected === true
      ? { unvalidatedExpected: true as const }
      : {}),
  };
}

export function dependencyFailedScores(
  planned: EvalPlannedCell,
): EvalCell["scores"] {
  return Object.freeze(
    planned.scorerActions.map((action) =>
      Object.freeze({
        status: "missing" as const,
        reason: "dependency_failed" as const,
        name: action.scorerName,
        contractFingerprint:
          action.contractFingerprint ?? "identity_unavailable",
        message: `Managed external scorer '${action.scorerName}' was not called because its task dependency failed.`,
        work: Object.freeze({
          status: "not_called" as const,
          reason: "dependency_failed" as const,
          reservation: "released" as const,
        }),
      }),
    ),
  );
}

export function freezeCell(cell: EvalCell): EvalCell {
  return Object.freeze({
    ...cell,
    task: Object.freeze({ ...cell.task }),
    scores: Object.freeze([...cell.scores]),
    metrics: Object.freeze({ ...cell.metrics }),
    runIds: Object.freeze([...cell.runIds]),
    capturedSignals: Object.freeze([...cell.capturedSignals]),
    ...(cell.error !== undefined
      ? { error: Object.freeze({ ...cell.error }) }
      : {}),
  });
}
