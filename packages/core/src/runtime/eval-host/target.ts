import {
  executeEvalTaskForInternalUse,
  getEvalTaskDescriptorForInternalUse,
} from "../../eval/internal/task";
import type { JsonValue } from "../../storage";
import type { RuntimeTarget, RuntimeTargetContext } from "../engine/kernel";
import type { WorkItemError } from "../engine/work";
import type { RuntimeTargetId } from "../ports/ids";
import type { DeployedEvalRegistry } from "../eval-registry";
import { resolveDeployedEval } from "../eval-registry";
import { CruxRuntimeError } from "../engine/errors";
import { CRUX_EVAL_HOST_PROTOCOL, type SubmitEvalJobV1 } from "./types";
import type { EvalHostStore } from "./types";

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
      if (new Date(request.deadlineAt).getTime() <= input.now().getTime()) {
        return blocked("EVAL_JOB_DEADLINE_EXCEEDED", input.now());
      }
      const current = await input.store.state.getWork(work.workId, {
        namespace: work.namespace,
      });
      if (current?.status === "cancelled") {
        return blocked("EVAL_JOB_CANCELLED", input.now());
      }
      const resolved = resolveDeployedEval(input.registry, request);
      const startedAt = input.now().getTime();
      try {
        const descriptor = getEvalTaskDescriptorForInternalUse(
          resolved.variant.task,
        );
        const result = await executeEvalTaskForInternalUse(
          resolved.variant.task as never,
          resolved.case.authored.input as never,
          resolved.case.authored.call as never,
          resolved.variant.overrides,
        );
        const payload = {
          schemaVersion: 1,
          protocol: CRUX_EVAL_HOST_PROTOCOL,
          jobId: request.jobId,
          evalRunId: request.evalRunId,
          output: result.output,
          response: result.response,
          capturedSignals: descriptor.capabilities,
          runIds: [],
          metrics: {
            durationMs: Math.max(0, input.now().getTime() - startedAt),
            ...(typeof result.response.cost === "number" &&
            Number.isFinite(result.response.cost) &&
            result.response.cost >= 0
              ? { costUsd: result.response.cost }
              : {}),
          },
          observedIdentity: result.observedIdentity,
        };
        const resultRef = await input.store.results.put(
          payload as unknown as JsonValue,
          { namespace: work.namespace },
        );
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
    },
  });
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
  return "The deployed Eval task failed without exposing provider details.";
}
