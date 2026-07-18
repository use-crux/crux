/** Execute and assess one already-planned Eval cell. @internal */

import { assessEvalCell } from "./assess";
import { createTaskEvidenceEntry } from "./evidence";
import { executeExternalScorers } from "./external-scorer-executor";
import { fingerprintEvalValue, isReusableEvalValue } from "./identity";
import { getEvalTaskDescriptorForInternalUse } from "./task";
import { isEvalSnapshotPersistenceSafe } from "./redact";
import type { EvalExecutionPorts } from "./ports";
import type {
  EvalCell,
  EvalPlan,
  EvalPlannedCell,
  EvalTaskExecutionEvidence,
  EvalTaskHostResult,
} from "./types";
import { runEvalCellScope } from "./scope";
import {
  EMPTY_ASSERTIONS,
  cellIdentity,
  dependencyFailedScores,
  freezeCell,
} from "./cell-result";

export type EvidenceWriteStatus =
  | "written"
  | "failed"
  | "not_eligible"
  | "not_attempted";

export type EvidenceWriteReason =
  | "identity_unavailable"
  | "model_identity_unattested"
  | "untracked_external_dependency"
  | "task_binding_untracked"
  | "unresolved_source_dependency"
  | "implicit_media"
  | "capture_policy"
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
  readonly executionAttemptId: string;
}): Promise<EvalCellExecutionResult> {
  return runEvalCellScope(input.planned, () => executeCell(input));
}

async function executeCell(input: {
  readonly plan: EvalPlan;
  readonly planned: EvalPlannedCell;
  readonly ports: EvalExecutionPorts;
  readonly executionAttemptId: string;
}): Promise<EvalCellExecutionResult> {
  if (input.planned.action.kind === "skip") {
    return Object.freeze({
      cell: freezeCell({
        ...cellIdentity(input.planned),
        status: "skipped",
        skipReason: input.planned.action.detail ?? "source_skipped",
        task: { status: "skipped", reason: "source_skipped" },
        scores: Object.freeze([]),
        assertions: EMPTY_ASSERTIONS,
        metrics: { durationMs: 0 },
        runIds: Object.freeze([]),
        capturedSignals: Object.freeze([]),
      }),
      evidenceWrite: "not_attempted",
    });
  }
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
            ...(input.planned.action.reason === "fresh_requested" ||
            input.planned.action.reason === "performance_freshness"
              ? { executionAttemptId: input.executionAttemptId }
              : {}),
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
        ("fingerprint" in observed
          ? observed.fingerprint
          : fingerprintEvalValue(observed.fingerprintMaterial)) !==
        input.planned.action.plannedAdapterFingerprint
      ) {
        evidenceWrite = "not_eligible";
        evidenceWriteReason = "observed_identity_mismatch";
      } else {
        const descriptor = getEvalTaskDescriptorForInternalUse(
          input.planned.task,
        );
        if (
          descriptor.projectRenderedPromptIdentity !== undefined &&
          liveResult.renderedPromptFingerprint === undefined
        ) {
          evidenceWrite = "not_eligible";
          evidenceWriteReason = "untracked_external_dependency";
          liveResult = undefined;
        }
      }
      if (liveResult !== undefined && evidenceWrite === "not_attempted") {
        const entry = createTaskEvidenceEntry(
          input.planned.action.evidenceKey,
          liveResult,
          input.ports.persistencePolicy,
        );
        if (entry === undefined) {
          evidenceWrite = "not_eligible";
          evidenceWriteReason =
            !isReusableEvalValue(liveResult.output) ||
            (liveResult.response !== undefined &&
              !isReusableEvalValue(liveResult.response))
              ? "implicit_media"
              : !isEvalSnapshotPersistenceSafe(
                    liveResult.output,
                    input.ports.persistencePolicy,
                  ) ||
                  (liveResult.response !== undefined &&
                    !isEvalSnapshotPersistenceSafe(
                      liveResult.response,
                      input.ports.persistencePolicy,
                    ))
                ? "capture_policy"
                : "implicit_media";
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
      planAfterScores: input.plan.afterScores,
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
                ...(input.planned.action.freshnessSource !== undefined
                  ? {
                      freshnessSource: input.planned.action.freshnessSource,
                    }
                  : {}),
              },
        scores: assessment.scores,
        assertions: assessment.assertions,
        output: execution.output,
        ...(execution.response !== undefined
          ? { response: execution.response }
          : {}),
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
