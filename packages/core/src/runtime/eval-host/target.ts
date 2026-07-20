import { executeObservedEvalTaskForInternalUse } from "../../eval/internal/observed-task";
import type { RuntimeTarget, RuntimeTargetContext } from "../engine/kernel";
import type { WorkItemError } from "../engine/work";
import type { RuntimeTargetId } from "../ports/ids";
import type { DeployedEvalRegistry } from "../eval-registry";
import { resolveDeployedEval } from "../eval-registry";
import { CruxRuntimeError } from "../engine/errors";
import type { SubmitEvalJobV1 } from "./types";
import type { EvalHostStore } from "./types";
import { encodeEvalHostResult } from "./result-codec";
import { isEvalSnapshotRedactionSafe } from "../../eval/internal/redact";
import { isReusableEvalValue } from "../../eval/internal/identity";
import { openEvalCellScope, runEvalScope } from "../../eval/internal/scope";

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
      const request = work.work.input as unknown as SubmitEvalJobV1;
      return runEvalScope(request.evalId, async () => {
        const cell = openEvalCellScope(request);
        if (new Date(request.deadlineAt).getTime() <= input.now().getTime()) {
          cell.seal("timeout");
          return blocked("EVAL_JOB_DEADLINE_EXCEEDED", input.now());
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
              const evidence = await executeObservedEvalTaskForInternalUse(
                {
                  evalId: request.evalId,
                  caseId: request.caseId,
                  variant: request.variant,
                  trial: request.trial,
                  task: resolved.variant.task,
                  overrides: resolved.variant.overrides,
                  input: resolved.case.authored.input as Readonly<
                    Record<string, unknown>
                  >,
                  ...(resolved.case.authored.call !== undefined
                    ? {
                        call: resolved.case.authored.call as Readonly<
                          Record<string, unknown>
                        >,
                      }
                    : {}),
                },
                () => input.now().getTime(),
              );
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
          cell.seal(scopeOutcomeFor(result));
          return result;
        } catch (error) {
          cell.seal("error");
          throw error;
        }
      });
    },
  });
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
