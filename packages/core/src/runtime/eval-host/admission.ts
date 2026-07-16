import type { JsonValue } from "../../storage";
import type { InMemoryRuntimeStore } from "../adapters/memory";
import type { RuntimeKernel } from "../engine/kernel";
import { wakeEnvelopeForWork } from "../engine/kernel";
import { enqueueTaskInTransaction } from "../engine/kernel-tasks";
import type { TaskId } from "../ports/ids";
import {
  DeployedEvalRegistryError,
  resolveDeployedEval,
} from "../eval-registry";
import { decodeSubmitEvalJob, EvalHostProtocolError } from "./protocol";
import { projectEvalJobStatus, workId } from "./status";
import { EVAL_EXECUTE_TARGET_ID } from "./target";
import type { CreateMemoryEvalHostOptions } from "./types";
import { jsonResponse } from "./transport";

/** Context required to validate and durably admit one exact deployed Case. */
export interface EvalHostAdmissionContext {
  readonly registry: CreateMemoryEvalHostOptions["registry"];
  readonly store: InMemoryRuntimeStore;
  readonly kernel: RuntimeKernel;
  readonly namespace: string;
  readonly now: () => Date;
  readonly maxConcurrentJobs: number;
  readonly hostCapabilities: readonly string[];
}

/** Validate, deduplicate, and enqueue one Eval job. */
export async function submitEvalJob(
  request: Request,
  context: EvalHostAdmissionContext,
): Promise<Response> {
  let job: ReturnType<typeof decodeSubmitEvalJob>;
  try {
    job = decodeSubmitEvalJob(await request.text(), context.now());
    const resolved = resolveDeployedEval(context.registry, job);
    if (
      resolved.entry.requiredHostCapabilities.some(
        (capability) => !context.hostCapabilities.includes(capability),
      )
    ) {
      return jsonResponse(
        { error: admissionError("EVAL_HOST_CAPABILITY_UNSUPPORTED") },
        409,
      );
    }
  } catch (error) {
    if (error instanceof EvalHostProtocolError) {
      return jsonResponse({ error: protocolError(error) }, 400);
    }
    if (error instanceof DeployedEvalRegistryError) {
      return jsonResponse(
        { error: admissionError(`EVAL_${error.code.toUpperCase()}`) },
        409,
      );
    }
    throw error;
  }

  const id = workId(job.jobId);
  let created = false;
  const work = await context.store
    .transact(async (tx) => {
      const existing = await tx.state.getWork(id, {
        namespace: context.namespace,
      });
      if (existing !== null) return existing;
      const counts = await tx.state.countWork({ namespace: context.namespace });
      const active = counts
        .filter(
          (entry) => entry.status === "pending" || entry.status === "leased",
        )
        .reduce((total, entry) => total + entry.count, 0);
      if (active >= context.maxConcurrentJobs) {
        throw new EvalHostCapacityError();
      }
      created = true;
      return await enqueueTaskInTransaction(
        tx,
        { newWorkId: () => id, now: context.now },
        {
          namespace: context.namespace,
          taskId: job.jobId as TaskId,
          targetId: EVAL_EXECUTE_TARGET_ID,
          input: job as unknown as JsonValue,
        },
      );
    })
    .catch((error: unknown) => {
      if (error instanceof EvalHostCapacityError) return error;
      throw error;
    });
  if (work instanceof EvalHostCapacityError) {
    return jsonResponse({ error: capacityError() }, 429);
  }
  if (work.work.kind !== "task.run" || !sameJob(work.work.input, job)) {
    return jsonResponse({ error: admissionError("IDEMPOTENCY_CONFLICT") }, 409);
  }
  if (created) {
    queueMicrotask(() => {
      void context.kernel.handleWake(wakeEnvelopeForWork(work));
    });
    return jsonResponse(
      {
        status: "accepted",
        jobId: job.jobId,
        evalRunId: job.evalRunId,
        attempt: work.attempt,
        revision: 1,
        createdAt: work.createdAt.toISOString(),
        updatedAt: work.updatedAt.toISOString(),
      },
      202,
    );
  }
  const status = await projectEvalJobStatus({
    store: context.store,
    namespace: context.namespace,
    jobId: job.jobId,
  });
  return jsonResponse(status.body, status.statusCode);
}

function sameJob(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function protocolError(error: EvalHostProtocolError) {
  return {
    code: error.code,
    message: error.message,
    retryable: false,
    phase: "admission",
  } as const;
}

function admissionError(code: string) {
  return {
    code,
    message:
      code === "IDEMPOTENCY_CONFLICT"
        ? "The Eval job ID is already bound to a different request."
        : "The deployed Eval identity is missing, stale, or unsupported by this host.",
    retryable: false,
    phase: "admission",
  } as const;
}

function capacityError() {
  return {
    code: "EVAL_HOST_CONCURRENCY_LIMIT",
    message: "The Eval host has reached its admitted job concurrency limit.",
    retryable: false,
    phase: "admission",
  } as const;
}

class EvalHostCapacityError extends Error {}
