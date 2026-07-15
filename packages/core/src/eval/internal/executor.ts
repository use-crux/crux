/** Portable execution facade for one admitted Current-cell plan. @internal */

import { aggregateCurrent } from "./aggregate";
import { assessEvalCell } from "./assess";
import { createTaskEvidenceEntry } from "./evidence";
import { executeExternalScorers } from "./external-scorer-executor";
import { evaluateCurrentGates } from "./gates";
import { fingerprintEvalValue } from "./identity";
import type { EvalExecutionPorts } from "./ports";
import type {
  EvalAssertionSummary,
  EvalCell,
  EvalPlan,
  EvalRun,
  EvalTaskExecutionEvidence,
  EvalTaskHostResult,
} from "./types";

const EMPTY_ASSERTIONS: EvalAssertionSummary = Object.freeze({
  ran: 0,
  notEvaluated: 0,
  outcomes: Object.freeze([]),
});

export async function executeEvalPlan(
  plan: EvalPlan,
  ports: EvalExecutionPorts,
): Promise<EvalRun> {
  const startedAt = ports.clock.now();
  const runId = ports.ids.next("run");
  const planned = plan.cells[0];
  let execution: EvalTaskExecutionEvidence | undefined;
  let cell: EvalCell;
  let incompleteReason:
    | "task_error"
    | "assertion_error"
    | "scorer_error"
    | undefined;
  let evidenceWrite: "written" | "failed" | "not_eligible" | "not_attempted" =
    "not_attempted";
  let evidenceWriteReason:
    | "identity_unavailable"
    | "untracked_external_dependency"
    | "implicit_media"
    | "observed_identity_mismatch"
    | undefined;

  try {
    let liveResult: EvalTaskHostResult | undefined;
    if (planned.action.kind === "reuse") {
      execution = planned.action.evidence.result;
    } else {
      liveResult = await ports.taskHost.execute({
        evalId: plan.evalId,
        caseId: planned.caseId,
        variant: "current",
        trial: 0,
        task: plan.task,
        input: planned.input,
        ...(planned.call !== undefined ? { call: planned.call } : {}),
      });
      execution = liveResult;
    }
    if (
      planned.action.kind === "execute" &&
      planned.action.evidenceKey !== undefined &&
      planned.action.plannedAdapterFingerprint !== undefined &&
      liveResult !== undefined &&
      ports.evidenceStore !== undefined
    ) {
      const observed = liveResult.observedIdentity;
      if (!observed.reusable) {
        evidenceWrite = "not_eligible";
        evidenceWriteReason = observed.reason;
      } else if (
        fingerprintEvalValue(observed.fingerprintMaterial) !==
        planned.action.plannedAdapterFingerprint
      ) {
        evidenceWrite = "not_eligible";
        evidenceWriteReason = "observed_identity_mismatch";
      } else {
        const entry = createTaskEvidenceEntry(
          planned.action.evidenceKey,
          liveResult,
        );
        if (entry === undefined) {
          evidenceWrite = "not_eligible";
          evidenceWriteReason = "implicit_media";
        } else {
          try {
            await ports.evidenceStore.write(entry);
            evidenceWrite = "written";
          } catch {
            evidenceWrite = "failed";
          }
        }
      }
    }
    const managedScores = await executeExternalScorers({
      plan,
      execution,
      ports,
    });
    const assessment = await assessEvalCell({
      planExpect: plan.expect,
      scorers: plan.scorers,
      cell: planned,
      execution,
      managedScores,
    });
    const assertionFailed = assessment.assertions.outcomes.some(
      (outcome) =>
        outcome.status === "failed" || outcome.status === "uncaptured",
    );
    if (assessment.error !== undefined) {
      incompleteReason =
        assessment.error.phase === "score" ? "scorer_error" : "assertion_error";
    }
    cell = freezeCell({
      caseId: planned.caseId,
      ...(planned.caseName !== undefined ? { caseName: planned.caseName } : {}),
      variant: "current",
      trial: 0,
      status:
        assessment.error !== undefined
          ? "errored"
          : assertionFailed
            ? "failed"
            : "passed",
      task:
        planned.action.kind === "reuse"
          ? {
              status: "reused",
              reason: "exact_evidence",
              evidenceFingerprint: planned.action.evidence.fingerprint,
              evidenceRef: planned.action.evidence.key,
            }
          : {
              status: "executed",
              reason: planned.action.reason,
              ...(planned.action.evidenceKey !== undefined
                ? {
                    evidenceFingerprint: planned.action.evidenceKey,
                    evidenceRef: planned.action.evidenceKey,
                  }
                : {}),
            },
      scores: assessment.scores,
      assertions: assessment.assertions,
      input: planned.input,
      ...(planned.call !== undefined ? { call: planned.call } : {}),
      output: execution.output,
      ...(planned.expected !== undefined ? { expected: planned.expected } : {}),
      response: execution.response,
      ...(assessment.error !== undefined ? { error: assessment.error } : {}),
      metrics: execution.metrics,
      runIds: execution.runIds,
      capturedSignals: execution.capturedSignals,
    });
  } catch (error) {
    incompleteReason = "task_error";
    cell = freezeCell({
      caseId: planned.caseId,
      ...(planned.caseName !== undefined ? { caseName: planned.caseName } : {}),
      variant: "current",
      trial: 0,
      status: "errored",
      task: { status: "errored", reason: "task_error" },
      scores: dependencyFailedScores(plan),
      assertions: EMPTY_ASSERTIONS,
      input: planned.input,
      ...(planned.call !== undefined ? { call: planned.call } : {}),
      ...(planned.expected !== undefined ? { expected: planned.expected } : {}),
      error: {
        message: error instanceof Error ? error.message : String(error),
        phase: "execute",
      },
      metrics: { durationMs: 0 },
      runIds: [],
      capturedSignals: [],
    });
  }

  const endedAt = ports.clock.now();
  const aggregate = aggregateCurrent(cell);
  const gates = evaluateCurrentGates(cell);
  const actualUsd = cell.metrics.costUsd;
  const base = {
    schemaVersion: 3 as const,
    runId,
    evalId: plan.evalId,
    sourceKey: plan.sourceKey,
    startedAt,
    endedAt,
    definitionFingerprint: plan.definitionFingerprint,
    selection: plan.selection,
    costControl: "not_required" as const,
    blockingVariants: Object.freeze(["current"] as const),
    cells: Object.freeze([cell] as const),
    variants: Object.freeze([
      Object.freeze({
        name: "current" as const,
        fingerprint: `phase5:${plan.evalId}:current`,
        overrideKeys: Object.freeze([]) as readonly [],
        blocking: true as const,
      }),
    ] as const),
    aggregates: Object.freeze({ current: aggregate }),
    gates,
    cost: Object.freeze({
      ...(actualUsd !== undefined ? { actualUsd } : {}),
      reservedMaximumUsd: 0 as const,
      unknownActionCount: 0 as const,
      task: Object.freeze({
        ...(actualUsd !== undefined ? { actualUsd } : {}),
      }),
      judge: Object.freeze({ actualUsd: 0 as const }),
    }),
    provenance: Object.freeze({
      task: "managed" as const,
      host: "injected" as const,
      evidenceStore:
        ports.evidenceStore === undefined
          ? ("none" as const)
          : Object.freeze({
              identity: ports.evidenceStore.identity,
              consistency: ports.evidenceStore.consistency,
              write: evidenceWrite,
              ...(evidenceWriteReason !== undefined
                ? { writeReason: evidenceWriteReason }
                : {}),
            }),
    }),
  };
  const run: EvalRun = Object.freeze(
    incompleteReason === undefined
      ? { ...base, status: "complete" as const, passed: gates.passed }
      : {
          ...base,
          status: "incomplete" as const,
          passed: false as const,
          reasons: Object.freeze([incompleteReason] as const),
        },
  );
  await ports.runStore.write(run);
  return run;
}

function dependencyFailedScores(
  plan: EvalPlan,
): readonly EvalCell["scores"][number][] {
  return Object.freeze(
    plan.scorerActions.map((action) =>
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
