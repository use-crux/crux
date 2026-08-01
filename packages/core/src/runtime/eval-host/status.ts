import type { JsonValue } from "../../storage";
import type { RuntimeWorkItem } from "../engine/work";
import type { WorkId } from "../ports/ids";
import type { RuntimeWork } from "../ports/work";
import type { EvalHostTimeoutV2, SubmitEvalJob } from "./types";
import type { EvalHostStore } from "./types";

/** Project one Runtime work row into the stable Eval host poll union. */
export async function projectEvalJobStatus(input: {
  readonly store: EvalHostStore;
  readonly namespace: string;
  readonly jobId: string;
}): Promise<{ readonly statusCode: number; readonly body: JsonValue }> {
  const work = await input.store.state.getWork(workId(input.jobId), {
    namespace: input.namespace,
  });
  if (work === null || !isEvalJobWork(work)) {
    return {
      statusCode: 404,
      body: { error: hostError("EVAL_JOB_NOT_FOUND", "admission") },
    };
  }
  const request = work.work.input as unknown as SubmitEvalJob;
  const common = {
    jobId: request.jobId,
    evalRunId: request.evalRunId,
    attempt: work.attempt,
    createdAt: work.createdAt.toISOString(),
    updatedAt: work.updatedAt.toISOString(),
  };
  switch (work.status) {
    case "pending":
      return {
        statusCode: 200,
        body: { ...common, status: "accepted", revision: 1 },
      };
    case "leased":
      return {
        statusCode: 200,
        body: { ...common, status: "running", revision: 2 },
      };
    case "completed":
      return await completedStatus(input.store, work, common);
    case "cancelled":
      return {
        statusCode: 200,
        body: {
          ...common,
          status: "cancelled",
          revision: 3,
          error: hostError("EVAL_JOB_CANCELLED", "execute"),
        },
      };
    case "blocked": {
      const code = work.lastError?.code ?? "EVAL_JOB_EXECUTION_FAILED";
      const timeout =
        request.protocol === "crux.eval-host.v2"
          ? timeoutFromWork(work)
          : undefined;
      const expired =
        request.protocol === "crux.eval-host.v1"
          ? code.includes("DEADLINE")
          : timeout !== undefined;
      return {
        statusCode: 200,
        body: {
          ...common,
          status: expired ? "expired" : "failed",
          revision: 3,
          error: hostError(
            code,
            code.startsWith("EVAL_RESULT_") ? "result" : "execute",
          ),
          ...(timeout !== undefined ? { timeout } : {}),
        },
      };
    }
    case "dead-letter":
    case "suspended":
      return {
        statusCode: 200,
        body: {
          ...common,
          status: "failed",
          revision: 3,
          error: hostError("EVAL_JOB_EXECUTION_FAILED", "execute"),
        },
      };
  }
}

function timeoutFromWork(work: RuntimeWorkItem): JsonValue | undefined {
  const details = work.lastError?.details;
  if (
    !isRecord(details) ||
    details.kind !== "eval-host-timeout-v2" ||
    !isRecord(details.timeout)
  ) {
    return undefined;
  }
  const timeout = details.timeout;
  if (
    !isTimeoutBudget(timeout.budget) ||
    !Number.isSafeInteger(timeout.limitMs) ||
    Number(timeout.limitMs) <= 0 ||
    (timeout.phase !== "pre_start" && timeout.phase !== "in_flight") ||
    (timeout.toolName !== undefined &&
      (timeout.budget !== "tool" || typeof timeout.toolName !== "string"))
  ) {
    return undefined;
  }
  return {
    budget: timeout.budget,
    limitMs: timeout.limitMs as number,
    ...(typeof timeout.toolName === "string"
      ? { toolName: timeout.toolName }
      : {}),
    phase: timeout.phase,
  };
}

function isTimeoutBudget(value: unknown): value is EvalHostTimeoutV2["budget"] {
  return ["total", "step", "chunk", "firstToken", "tool"].includes(
    String(value),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function workId(jobId: string): WorkId {
  return `eval-job:${jobId}` as WorkId;
}

function isEvalJobWork(work: RuntimeWorkItem): work is RuntimeWorkItem & {
  readonly work: Extract<RuntimeWork, { readonly kind: "task.run" }> & {
    readonly input: JsonValue;
  };
} {
  return (
    work.targetId === "_crux.eval.execute" &&
    work.work.kind === "task.run" &&
    work.work.input !== undefined
  );
}

async function completedStatus(
  store: EvalHostStore,
  work: RuntimeWorkItem,
  common: Readonly<Record<string, JsonValue>>,
): Promise<{ readonly statusCode: number; readonly body: JsonValue }> {
  if (work.resultRef === undefined) return corruptResult(common);
  try {
    const result = await store.results.get(work.resultRef);
    if (result === null) return corruptResult(common);
    return {
      statusCode: 200,
      body: {
        ...common,
        status: "succeeded",
        revision: 3,
        resultRef: work.resultRef as unknown as JsonValue,
        result,
      },
    };
  } catch {
    return corruptResult(common);
  }
}

function corruptResult(common: Readonly<Record<string, JsonValue>>) {
  return {
    statusCode: 200,
    body: {
      ...common,
      status: "failed",
      revision: 3,
      error: hostError("EVAL_RESULT_INTEGRITY_FAILED", "result"),
    },
  } as const;
}

function hostError(
  code: string,
  phase: "admission" | "execute" | "result",
): JsonValue {
  return {
    code,
    message: messageForCode(code),
    retryable: false,
    phase,
  };
}

function messageForCode(code: string): string {
  switch (code) {
    case "EVAL_JOB_NOT_FOUND":
      return "The Eval job is not registered on this deployment.";
    case "EVAL_JOB_CANCELLED":
      return "The Eval job was cancelled.";
    case "EVAL_RESULT_INTEGRITY_FAILED":
      return "The Eval result is missing or failed integrity verification.";
    case "EVAL_RESULT_TOO_LARGE":
      return "The normalized Eval result exceeds the 1 MiB protocol ceiling.";
    default:
      return "The deployed Eval task failed without exposing provider details.";
  }
}
