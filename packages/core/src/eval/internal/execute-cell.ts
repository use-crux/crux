/** Execute and assess one already-planned Eval cell. @internal */

import { assessEvalCell } from "./assess";
import { createTaskEvidenceEntry } from "./evidence";
import { executeExternalScorers } from "./external-scorer-executor";
import { fingerprintEvalValue } from "./identity";
import type { EvalExecutionPorts } from "./ports";
import type {
  EvalAssertionSummary,
  EvalCell,
  EvalPlan,
  EvalPlannedCell,
  EvalTaskExecutionEvidence,
  EvalTaskHostResult,
} from "./types";

export type EvidenceWriteStatus =
  | "written"
  | "failed"
  | "not_eligible"
  | "not_attempted";

export type EvidenceWriteReason =
  | "identity_unavailable"
  | "untracked_external_dependency"
  | "implicit_media"
  | "observed_identity_mismatch";

export interface EvalCellExecutionResult {
  readonly cell: EvalCell;
  readonly incompleteReason?: "task_error" | "assertion_error" | "scorer_error";
  readonly evidenceWrite: EvidenceWriteStatus;
  readonly evidenceWriteReason?: EvidenceWriteReason;
}

/** Consume one admitted cell without creating any new task/scorer work. */
export async function executePlannedCell(input: {
  readonly plan: EvalPlan;
  readonly planned: EvalPlannedCell;
  readonly ports: EvalExecutionPorts;
}): Promise<EvalCellExecutionResult> {
  let evidenceWrite: EvidenceWriteStatus = "not_attempted";
  let evidenceWriteReason: EvidenceWriteReason | undefined;
  try {
    let liveResult: EvalTaskHostResult | undefined;
    const execution: EvalTaskExecutionEvidence =
      input.planned.action.kind === "reuse"
        ? input.planned.action.evidence.result
        : (liveResult = await input.ports.taskHost.execute({
            evalId: input.plan.evalId,
            caseId: input.planned.caseId,
            variant: input.planned.variant,
            trial: input.planned.trial,
            task: input.planned.task,
            overrides: input.planned.overrides,
            input: input.planned.input,
            ...(input.planned.call !== undefined
              ? { call: input.planned.call }
              : {}),
          }));
    if (
      input.planned.action.kind === "execute" &&
      input.planned.action.evidenceKey !== undefined &&
      input.planned.action.plannedAdapterFingerprint !== undefined &&
      liveResult !== undefined &&
      input.ports.evidenceStore !== undefined
    ) {
      const observed = liveResult.observedIdentity;
      if (!observed.reusable) {
        evidenceWrite = "not_eligible";
        evidenceWriteReason = observed.reason;
      } else if (
        fingerprintEvalValue(observed.fingerprintMaterial) !==
        input.planned.action.plannedAdapterFingerprint
      ) {
        evidenceWrite = "not_eligible";
        evidenceWriteReason = "observed_identity_mismatch";
      } else {
        const entry = createTaskEvidenceEntry(
          input.planned.action.evidenceKey,
          liveResult,
        );
        if (entry === undefined) {
          evidenceWrite = "not_eligible";
          evidenceWriteReason = "implicit_media";
        } else {
          try {
            await input.ports.evidenceStore.write(entry);
            evidenceWrite = "written";
          } catch {
            evidenceWrite = "failed";
          }
        }
      }
    }
    const managedScores = await executeExternalScorers({
      cell: input.planned,
      execution,
      ports: input.ports,
    });
    const assessment = await assessEvalCell({
      planExpect: input.plan.expect,
      scorers: input.plan.scorers,
      cell: input.planned,
      execution,
      managedScores,
    });
    const assertionFailed = assessment.assertions.outcomes.some(
      (outcome) =>
        outcome.status === "failed" || outcome.status === "uncaptured",
    );
    return Object.freeze({
      cell: freezeCell({
        ...cellIdentity(input.planned),
        status:
          assessment.error !== undefined
            ? "errored"
            : assertionFailed
              ? "failed"
              : "passed",
        task:
          input.planned.action.kind === "reuse"
            ? {
                status: "reused",
                reason: "exact_evidence",
                evidenceFingerprint: input.planned.action.evidence.fingerprint,
                evidenceRef: input.planned.action.evidence.key,
              }
            : {
                status: "executed",
                reason: input.planned.action.reason,
                ...(input.planned.action.evidenceKey !== undefined
                  ? {
                      evidenceFingerprint: input.planned.action.evidenceKey,
                      evidenceRef: input.planned.action.evidenceKey,
                    }
                  : {}),
              },
        scores: assessment.scores,
        assertions: assessment.assertions,
        output: execution.output,
        response: execution.response,
        ...(assessment.error !== undefined ? { error: assessment.error } : {}),
        metrics: execution.metrics,
        runIds: execution.runIds,
        capturedSignals: execution.capturedSignals,
      }),
      ...(assessment.error !== undefined
        ? {
            incompleteReason:
              assessment.error.phase === "score"
                ? ("scorer_error" as const)
                : ("assertion_error" as const),
          }
        : {}),
      evidenceWrite,
      ...(evidenceWriteReason !== undefined ? { evidenceWriteReason } : {}),
    });
  } catch (error) {
    return Object.freeze({
      cell: freezeCell({
        ...cellIdentity(input.planned),
        status: "errored",
        task: { status: "errored", reason: "task_error" },
        scores: dependencyFailedScores(input.planned),
        assertions: EMPTY_ASSERTIONS,
        error: {
          message: error instanceof Error ? error.message : String(error),
          phase: "execute",
        },
        metrics: { durationMs: 0 },
        runIds: [],
        capturedSignals: [],
      }),
      incompleteReason: "task_error",
      evidenceWrite,
      ...(evidenceWriteReason !== undefined ? { evidenceWriteReason } : {}),
    });
  }
}

function cellIdentity(planned: EvalPlannedCell) {
  return {
    caseId: planned.caseId,
    ...(planned.caseName !== undefined ? { caseName: planned.caseName } : {}),
    variant: planned.variant,
    trial: planned.trial,
    input: planned.input,
    ...(planned.call !== undefined ? { call: planned.call } : {}),
    ...(planned.expected !== undefined ? { expected: planned.expected } : {}),
  };
}

function dependencyFailedScores(planned: EvalPlannedCell): EvalCell["scores"] {
  return Object.freeze(
    planned.scorerActions.map((action) =>
      Object.freeze({
        status: "errored" as const,
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

function freezeCell(cell: EvalCell): EvalCell {
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

const EMPTY_ASSERTIONS: EvalAssertionSummary = Object.freeze({
  ran: 0,
  notEvaluated: 0,
  outcomes: Object.freeze([]),
});
