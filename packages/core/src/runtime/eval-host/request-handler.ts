import type { RuntimeKernel } from "../engine/kernel";
import type { RuntimeWakeDeliver } from "../engine/outbox";
import { submitEvalJob } from "./admission";
import { assertEvalHostToken, hasEvalHostAuthorization } from "./auth";
import { createEvalHostManifest } from "./manifest";
import { projectEvalJobStatus, workId } from "./status";
import type {
  CreateEvalHostOptions,
  EvalHostFetchHandler,
  EvalHostKind,
  EvalHostStore,
} from "./types";
import {
  admitPoll,
  insecureTransportError,
  isSecureRequest,
  jobIdFromPath,
  jsonResponse,
  pollRateError,
  routeError,
  unauthorizedError,
} from "./transport";

/** Construct the shared authenticated manifest and job request router. */
export function createEvalHostRequestHandler(
  options: CreateEvalHostOptions & {
    readonly store: EvalHostStore;
    readonly kernel: RuntimeKernel;
    readonly namespace: string;
    readonly hostKind: EvalHostKind;
    readonly now: () => Date;
    readonly scheduleWake: RuntimeWakeDeliver;
  },
): EvalHostFetchHandler {
  assertEvalHostToken(options.token);
  const maxConcurrentJobs = positiveLimit(
    options.limits?.maxConcurrentJobs,
    64,
  );
  const maxPollsPerSecond = positiveLimit(
    options.limits?.maxPollsPerSecond,
    120,
  );
  const pollWindows = new Map<string, { second: number; count: number }>();
  const manifest = createEvalHostManifest({
    deploymentId: options.deploymentId,
    hostKind: options.hostKind,
    registry: options.registry,
    hostCapabilities: options.hostCapabilities,
  });
  return Object.freeze({
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
          store: options.store,
          kernel: options.kernel,
          namespace: options.namespace,
          now: options.now,
          maxConcurrentJobs,
          hostCapabilities: options.hostCapabilities ?? [],
          scheduleWake: options.scheduleWake,
        });
      }
      const jobId = jobIdFromPath(url.pathname);
      if (request.method === "GET" && jobId !== undefined) {
        if (!admitPoll(pollWindows, jobId, options.now(), maxPollsPerSecond)) {
          return jsonResponse({ error: pollRateError() }, 429);
        }
        const status = await projectEvalJobStatus({
          store: options.store,
          namespace: options.namespace,
          jobId,
        });
        return jsonResponse(status.body, status.statusCode);
      }
      if (request.method === "DELETE" && jobId !== undefined) {
        await options.kernel.cancelWork({
          namespace: options.namespace,
          workId: workId(jobId),
        });
        const status = await projectEvalJobStatus({
          store: options.store,
          namespace: options.namespace,
          jobId,
        });
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
