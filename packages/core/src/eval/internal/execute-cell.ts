/** Execute and assess one already-planned Eval cell. @internal */

import { assessEvalCell } from "./assess";
import { executeExternalScorers } from "./external-scorer-executor";
import type { EvalExecutionPorts } from "./ports";
import type {
  EvalCell,
  EvalCellTimeout,
  EvalPlan,
  EvalPlannedCell,
  EvalTaskExecutionEvidence,
  EvalTaskHostResult,
} from "./types";
import { openEvalCellScope } from "./scope";
import { runWithCellDeadline } from "./cell-deadline";
import { createTimedOutEvalCell } from "./timeout-outcome";
import { snapshotEvalCellObservation } from "./cell-observation";
import {
  EMPTY_ASSERTIONS,
  cellIdentity,
  dependencyFailedScores,
  freezeCell,
} from "./cell-result";
import {
  writeTaskEvidence,
  type EvidenceWriteReason,
  type EvidenceWriteStatus,
} from "./task-evidence-write";
import {
  executeEvalTaskHost,
  type EvalTaskHostOutcome,
} from "./task-host-outcome";
import { timeoutEvalCellObservabilityRun } from "./cell-observability-run";

export type {
  EvidenceWriteReason,
  EvidenceWriteStatus,
} from "./task-evidence-write";

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
  const scope = openEvalCellScope(input.planned);
  try {
    const result = await scope.run(() =>
      executeCell({
        ...input,
        expireTimeout: (abort) =>
          scope.run(() => {
            timeoutEvalCellObservabilityRun(abort.timeout);
            const observation = snapshotEvalCellObservation();
            scope.seal("timeout");
            abort.abort();
            return observation;
          }),
      }),
    );
    if (result.cell.status !== "timed_out") scope.seal("success");
    return result;
  } catch (error) {
    scope.seal("error");
    throw error;
  }
}

async function executeCell(input: {
  readonly plan: EvalPlan;
  readonly planned: EvalPlannedCell;
  readonly ports: EvalExecutionPorts;
  readonly executionAttemptId: string;
  readonly expireTimeout: (
    abort: {
      readonly timeout: EvalCellTimeout;
      abort(): void;
    },
  ) => ReturnType<typeof snapshotEvalCellObservation>;
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
    if (input.planned.action.kind === "execute") {
      const live = await runWithCellDeadline({
        totalMs: input.planned.timeout.totalMs,
        timeout: input.planned.timeout.nested,
        clock: input.ports.cellDeadlineClock,
        expire: (abort) =>
          input.expireTimeout({ timeout: abort.timeout, abort: abort.abort }),
        timeoutFromValue: (outcome: EvalTaskHostOutcome) =>
          outcome.status === "timed_out" ? outcome.timeout : undefined,
        task: () =>
          executeEvalTaskHost(input.ports.taskHost, {
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
          }),
      });
      if (live.status === "timed_out") {
        return Object.freeze({
          cell: createTimedOutEvalCell({
            planned: input.planned,
            timeout: live.timeout,
            durationMs: live.durationMs,
            observation: live.observation,
          }),
          evidenceWrite: "not_attempted",
        });
      }
      if (live.value.status !== "completed") {
        throw new TypeError(
          "Timed-out task-host outcomes must terminate through the cell deadline.",
        );
      }
      liveResult = live.value.result;
    }
    const execution: EvalTaskExecutionEvidence =
      input.planned.action.kind === "reuse"
        ? input.planned.action.evidence.result
        : liveResult!;
    if (liveResult !== undefined) {
      const evidenceOutcome = await writeTaskEvidence({
        planned: input.planned,
        result: liveResult,
        ports: input.ports,
      });
      evidenceWrite = evidenceOutcome.status;
      evidenceWriteReason = evidenceOutcome.reason;
    }
    const managedScores = await executeExternalScorers({
      cell: input.planned,
      execution,
      ports: input.ports,
    });
    const assessment = await assessEvalCell({
      planExpect: input.plan.expect,
      planAfterScores: input.plan.afterScores,
      scorers: input.planned.scorers,
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
