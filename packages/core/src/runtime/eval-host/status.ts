import type { JsonValue } from "../../storage";
import type { WorkItem } from "../engine/work";
import type { WorkId } from "../ports/ids";
import type { RuntimeWork } from "../ports/work";
import type { SubmitEvalJobV1 } from "./types";
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
  const request = work.work.input as unknown as SubmitEvalJobV1;
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
      return {
        statusCode: 200,
        body: {
          ...common,
          status: code.includes("DEADLINE") ? "expired" : "failed",
          revision: 3,
          error: hostError(
            code,
            code.startsWith("EVAL_RESULT_") ? "result" : "execute",
          ),
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

export function workId(jobId: string): WorkId {
  return `eval-job:${jobId}` as WorkId;
}

function isEvalJobWork(work: WorkItem): work is WorkItem & {
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
  work: WorkItem,
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
