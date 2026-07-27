/** In-flight deadline enforcement for one deployed V2 Eval task. @internal */

import { runWithCellDeadline } from "../../eval/internal/cell-deadline";
import type { EvalCellObservationSnapshot } from "../../eval/internal/cell-observation";
import { executeObservedEvalTaskForInternalUse } from "../../eval/internal/observed-task";
import { classifyEvalTaskTimeout } from "../../eval/internal/task-timeout";
import type {
  EvalCellTimeout,
  EvalTaskHostResult,
} from "../../eval/internal/types";
import { getEvalDefinitionForInternalUse } from "../../eval/internal/definition";
import { resolveEvalTimeoutPolicy } from "../../eval/timeout-policy";
import type { ResolvedDeployedEval } from "../eval-registry";
import type { SubmitEvalJob, SubmitEvalJobV2 } from "./types";

/** Terminal result of one V2 deployed-task deadline race. */
export type EvalHostDeadlineResult =
  | {
      readonly status: "completed";
      readonly evidence: EvalTaskHostResult;
    }
  | {
      readonly status: "timed_out";
      readonly timeout: EvalCellTimeout;
      readonly observation: EvalCellObservationSnapshot;
    };

/**
 * Execute a deployed task with the frozen Eval policy and admitted deadline.
 *
 * The absolute deadline remainder drives the timer while the original relative
 * limit remains the structured timeout identity.
 */
export async function executeEvalHostTaskWithDeadline(input: {
  readonly request: SubmitEvalJobV2;
  readonly resolved: ResolvedDeployedEval;
  readonly now: () => number;
  readonly expire: (abort: {
    readonly timeout: EvalCellTimeout;
    abort(): void;
  }) => EvalCellObservationSnapshot;
}): Promise<EvalHostDeadlineResult> {
  const policy = resolveEvalTimeoutPolicy(
    getEvalDefinitionForInternalUse(input.resolved.entry.eval).timeout,
    input.resolved.case.authored.timeout,
  );
  const result = await runWithCellDeadline({
    totalMs: input.request.deadline.limitMs,
    delayMs: Math.max(
      0,
      new Date(input.request.deadlineAt).getTime() - input.now(),
    ),
    timeout: policy.nested,
    expire: input.expire,
    timeoutFromValue: (value: ClassifiedTaskResult) =>
      value.status === "timed_out" ? value.timeout : undefined,
    task: async () => await executeClassifiedTask(input),
  });
  if (result.status === "timed_out") {
    return Object.freeze({
      status: "timed_out",
      timeout: result.timeout,
      observation: result.observation,
    });
  }
  if (result.value.status !== "completed") {
    throw new TypeError("A classified timeout must win the deadline race.");
  }
  return Object.freeze({
    status: "completed",
    evidence: result.value.evidence,
  });
}

type ClassifiedTaskResult =
  | {
      readonly status: "completed";
      readonly evidence: EvalTaskHostResult;
    }
  | {
      readonly status: "timed_out";
      readonly timeout: EvalCellTimeout;
      readonly evidence?: never;
    };

async function executeClassifiedTask(input: {
  readonly request: SubmitEvalJobV2;
  readonly resolved: ResolvedDeployedEval;
  readonly now: () => number;
}): Promise<ClassifiedTaskResult> {
  try {
    return Object.freeze({
      status: "completed",
      evidence: await executeObservedEvalTaskForInternalUse(
        observedTaskRequest(input.request, input.resolved),
        input.now,
      ),
    });
  } catch (error) {
    const timeout = classifyEvalTaskTimeout(error);
    if (timeout === undefined) throw error;
    return Object.freeze({ status: "timed_out", timeout });
  }
}

/** Project the allowlisted deployed tuple into the managed task-host request. */
export function observedTaskRequest(
  request: SubmitEvalJob,
  resolved: ResolvedDeployedEval,
) {
  return {
    evalId: request.evalId,
    caseId: request.caseId,
    variant: request.variant,
    trial: request.trial,
    task: resolved.variant.task,
    overrides: resolved.variant.overrides,
    input: resolved.case.authored.input as Readonly<Record<string, unknown>>,
    ...(resolved.case.authored.call !== undefined
      ? {
          call: resolved.case.authored.call as Readonly<
            Record<string, unknown>
          >,
        }
      : {}),
  };
}
