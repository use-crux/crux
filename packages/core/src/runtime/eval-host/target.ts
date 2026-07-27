import { executeObservedEvalTaskForInternalUse } from "../../eval/internal/observed-task";
import type { RuntimeTarget, RuntimeTargetContext } from "../engine/kernel";
import type { WorkItemError } from "../engine/work";
import type { RuntimeTargetId } from "../ports/ids";
import type { DeployedEvalRegistry } from "../eval-registry";
import { resolveDeployedEval } from "../eval-registry";
import { CruxRuntimeError } from "../engine/errors";
import type { SubmitEvalJob } from "./types";
import type { EvalHostStore } from "./types";
import { encodeEvalHostResult } from "./result-codec";
import { isEvalSnapshotRedactionSafe } from "../../eval/internal/redact";
import { isReusableEvalValue } from "../../eval/internal/identity";
import { openEvalCellScope, runEvalScope } from "../../eval/internal/scope";
import { snapshotEvalCellObservation } from "../../eval/internal/cell-observation";
import type {
  EvalCellTimeout,
  EvalTaskHostResult,
} from "../../eval/internal/types";
import {
  executeEvalHostTaskWithDeadline,
  observedTaskRequest,
} from "./execute-deadline";
import { timeoutEvalCellObservabilityRun } from "../../eval/internal/cell-observability-run";

export const EVAL_EXECUTE_TARGET_ID = "_crux.eval.execute" as RuntimeTargetId;

/** Build the sole allowlisted Runtime target used by deployed Eval jobs. */
export function createEvalExecuteTarget(input: {
  readonly registry: DeployedEvalRegistry;
  readonly store: EvalHostStore;
  readonly now: () => Date;
}): RuntimeTarget {
  return Object.freeze({
    targetId: EVAL_EXECUTE_TARGET_ID,
    kind: "task" as const,
    async execute({ work }: RuntimeTargetContext) {
      if (
        work.work.kind !== "task.run" ||
        work.work.targetId !== EVAL_EXECUTE_TARGET_ID ||
        work.work.input === undefined
      ) {
        return blocked("EVAL_HOST_INVALID_WORK", input.now());
      }
      const request = work.work.input as unknown as SubmitEvalJob;
      return runEvalScope(request.evalId, async () => {
        const cell = openEvalCellScope(request);
        if (new Date(request.deadlineAt).getTime() <= input.now().getTime()) {
          cell.seal("timeout");
          return request.protocol === "crux.eval-host.v2"
            ? timedOut(request.deadline.limitMs, "pre_start", input.now())
            : blocked("EVAL_JOB_DEADLINE_EXCEEDED", input.now());
        }
        try {
          const result = await cell.run(async () => {
            const current = await input.store.state.getWork(work.workId, {
              namespace: work.namespace,
            });
            if (current?.status === "cancelled") {
              return blocked("EVAL_JOB_CANCELLED", input.now());
            }
            const resolved = resolveDeployedEval(input.registry, request);
            try {
              const evidence =
                request.protocol === "crux.eval-host.v2"
                  ? await executeV2Task({
                      request,
                      resolved,
                      now: () => input.now().getTime(),
                      expire: (abort) =>
                        cell.run(() => {
                          timeoutEvalCellObservabilityRun(abort.timeout);
                          const observation = snapshotEvalCellObservation();
                          cell.seal("timeout");
                          abort.abort();
                          return observation;
                        }),
                    })
                  : await executeObservedEvalTaskForInternalUse(
                      observedTaskRequest(request, resolved),
                      () => input.now().getTime(),
                    );
              if ("timeout" in evidence) {
                return blocked(
                  "EVAL_JOB_DEADLINE_EXCEEDED",
                  input.now(),
                  timeoutDetails(evidence.timeout, "in_flight"),
                );
              }
              if (
                !isReusableEvalValue(evidence.output) ||
                (evidence.response !== undefined &&
                  !isReusableEvalValue(evidence.response))
              ) {
                return blocked("EVAL_RESULT_MEDIA_NOT_DURABLE", input.now());
              }
              if (
                !isEvalSnapshotRedactionSafe(
                  evidence.output,
                  input.registry.persistencePolicy,
                ) ||
                !isEvalSnapshotRedactionSafe(
                  evidence.response,
                  input.registry.persistencePolicy,
                )
              ) {
                return blocked("EVAL_RESULT_REDACTION_REQUIRED", input.now());
              }
              const payload = encodeEvalHostResult({
                jobId: request.jobId,
                evalRunId: request.evalRunId,
                evidence,
              });
              const publishable = await input.store.state.getWork(work.workId, {
                namespace: work.namespace,
              });
              if (publishable?.status !== "leased") {
                return blocked("EVAL_JOB_CANCELLED", input.now());
              }
              const resultRef = await input.store.results.put(payload, {
                namespace: work.namespace,
              });
              return { status: "completed" as const, resultRef };
            } catch (error) {
              if (error instanceof CruxRuntimeError) {
                return blocked(
                  error.code === "PAYLOAD_NOT_JSON"
                    ? "EVAL_RESULT_MEDIA_NOT_DURABLE"
                    : error.code,
                  input.now(),
                );
              }
              return blocked("EVAL_JOB_EXECUTION_FAILED", input.now());
            }
          });
          if (!isTimedOut(result)) cell.seal(scopeOutcomeFor(result));
          return result;
        } catch (error) {
          cell.seal("error");
          throw error;
        }
      });
    },
  });
}

async function executeV2Task(
  input: Parameters<typeof executeEvalHostTaskWithDeadline>[0],
): Promise<EvalTaskHostResult | { readonly timeout: EvalCellTimeout }> {
  const result = await executeEvalHostTaskWithDeadline(input);
  return result.status === "completed"
    ? result.evidence
    : Object.freeze({ timeout: result.timeout });
}

function timedOut(
  limitMs: number,
  phase: "pre_start" | "in_flight",
  now: Date,
) {
  return blocked(
    "EVAL_JOB_DEADLINE_EXCEEDED",
    now,
    timeoutDetails({ budget: "total", limitMs }, phase),
  );
}

function timeoutDetails(
  timeout: EvalCellTimeout,
  phase: "pre_start" | "in_flight",
) {
  return Object.freeze({
    kind: "eval-host-timeout-v2",
    timeout: Object.freeze({ ...timeout, phase }),
  });
}

function isTimedOut(
  result:
    | Awaited<ReturnType<typeof blocked>>
    | { readonly status: "completed" },
): boolean {
  return (
    result.status === "blocked" &&
    isRecord(result.error.details) &&
    result.error.details.kind === "eval-host-timeout-v2"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scopeOutcomeFor(
  result:
    | Awaited<ReturnType<typeof blocked>>
    | { readonly status: "completed" },
): "success" | "error" | "cancelled" {
  if (result.status === "completed") return "success";
  return result.error.code === "EVAL_JOB_CANCELLED" ? "cancelled" : "error";
}

function blocked(
  code: string,
  now: Date,
  details?: WorkItemError["details"],
): {
  readonly status: "blocked";
  readonly error: WorkItemError;
} {
  return Object.freeze({
    status: "blocked" as const,
    error: Object.freeze({
      code,
      message: messageForCode(code),
      at: now,
      ...(details !== undefined ? { details } : {}),
    }),
  });
}

function messageForCode(code: string): string {
  if (code === "EVAL_JOB_DEADLINE_EXCEEDED") {
    return "The Eval job deadline elapsed before task execution.";
  }
  if (code === "EVAL_JOB_CANCELLED") return "The Eval job was cancelled.";
  if (code === "EVAL_RESULT_TOO_LARGE") {
    return "The normalized Eval result exceeds the 1 MiB protocol ceiling.";
  }
  if (code === "EVAL_RESULT_MEDIA_NOT_DURABLE") {
    return "Eval media output must use a durable Crux asset reference.";
  }
  if (code === "EVAL_RESULT_REDACTION_REQUIRED") {
    return "The Eval result conflicts with the generated project redaction policy and was not persisted.";
  }
  return "The deployed Eval task failed without exposing provider details.";
}
