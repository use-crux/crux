import { inMemoryRuntimeStore } from "../adapters/memory";
import { createRuntimeKernel } from "../engine/kernel";
import type { WorkId } from "../ports/ids";
import { submitEvalJob } from "./admission";
import { assertEvalHostToken, hasEvalHostAuthorization } from "./auth";
import { createEvalHostManifest } from "./manifest";
import { projectEvalJobStatus, workId } from "./status";
import { createEvalExecuteTarget, EVAL_EXECUTE_TARGET_ID } from "./target";
import type { CreateMemoryEvalHostOptions, MemoryEvalHost } from "./types";
import {
  admitPoll,
  insecureTransportError,
  jobIdFromPath,
  jsonResponse,
  pollRateError,
  routeError,
  unauthorizedError,
  isSecureRequest,
} from "./transport";

/** Create the process-local reference implementation of Eval host V1. */
export function createMemoryEvalHost(
  options: CreateMemoryEvalHostOptions,
): MemoryEvalHost {
  assertEvalHostToken(options.token);
  const now = options.now ?? (() => new Date());
  const maxConcurrentJobs = positiveLimit(
    options.limits?.maxConcurrentJobs,
    64,
  );
  const maxPollsPerSecond = positiveLimit(
    options.limits?.maxPollsPerSecond,
    120,
  );
  const pollWindows = new Map<string, { second: number; count: number }>();
  const store = inMemoryRuntimeStore();
  let generatedId = 0;
  const target = createEvalExecuteTarget({
    registry: options.registry,
    store,
    now,
  });
  const kernel = createRuntimeKernel({
    store,
    targets: { [EVAL_EXECUTE_TARGET_ID]: target },
    newWorkId: () => `eval-host-internal:${++generatedId}` as WorkId,
    now,
  });
  const namespace = `eval-host:${options.deploymentId}`;
  const manifest = createEvalHostManifest({
    deploymentId: options.deploymentId,
    hostKind: "memory",
    registry: options.registry,
  });
  return Object.freeze({
    store,
    async fetch(request: Request): Promise<Response> {
      if (!isSecureRequest(request)) {
        return jsonResponse({ error: insecureTransportError() }, 400);
      }
      if (!hasEvalHostAuthorization(request, options.token)) {
        return jsonResponse({ error: unauthorizedError() }, 401);
      }
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/manifest") {
        return jsonResponse(manifest, 200);
      }
      if (request.method === "POST" && url.pathname === "/jobs") {
        return await submitEvalJob(request, {
          registry: options.registry,
          store,
          kernel,
          namespace,
          now,
          maxConcurrentJobs,
          hostCapabilities: options.hostCapabilities ?? [],
        });
      }
      const jobId = jobIdFromPath(url.pathname);
      if (request.method === "GET" && jobId !== undefined) {
        if (!admitPoll(pollWindows, jobId, now(), maxPollsPerSecond)) {
          return jsonResponse({ error: pollRateError() }, 429);
        }
        const status = await projectEvalJobStatus({ store, namespace, jobId });
        return jsonResponse(status.body, status.statusCode);
      }
      if (request.method === "DELETE" && jobId !== undefined) {
        await kernel.cancelWork({ namespace, workId: workId(jobId) });
        const status = await projectEvalJobStatus({ store, namespace, jobId });
        return jsonResponse(status.body, status.statusCode);
      }
      return jsonResponse({ error: routeError() }, 404);
    },
  });
}

function positiveLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (Number.isSafeInteger(value) && value > 0) return value;
  throw new TypeError("Eval host limits must be positive safe integers.");
}
