/** Execute one managed task while retaining its real observability evidence. */

import { extractCellSignals } from "./execution-signals";
import { currentEvalCaptureSession } from "./capture-context";
import { runWithinEvalScopes } from "./scope";
import { executeEvalTaskForInternalUse } from "./task";
import type { EvalTaskHostRequest, EvalTaskHostResult } from "./types";
import { fingerprintEvalValue } from "./identity";
import { openEvalCellObservabilityRun } from "./cell-observability-run";

/** Shared local and deployed task path; declarations never masquerade as observations. */
export async function executeObservedEvalTaskForInternalUse(
  request: EvalTaskHostRequest,
  now: () => number = Date.now,
): Promise<EvalTaskHostResult> {
  return runWithinEvalScopes(request.evalId, request, () =>
    executeObservedManagedTask(request, now),
  );
}

async function executeObservedManagedTask(
  request: EvalTaskHostRequest,
  now: () => number,
): Promise<EvalTaskHostResult> {
  const startedAt = now();
  const capture = requireEvalCaptureSession();
  const observation = openEvalCellObservabilityRun(request);
  try {
    const result = await observation.withContext(() =>
      executeEvalTaskForInternalUse(
        request.task as never,
        request.input as never,
        request.call as never,
        request.overrides,
      ),
    );
    observation.ok();
    await capture.settle();
    const signals = extractCellSignals(capture.take(observation.runId));
    const costUsd = result.response.cost ?? signals.costUsd;
    const { renderedPromptIdentity, ...taskResult } = result;
    return Object.freeze({
      ...taskResult,
      ...(renderedPromptIdentity?.reusable === true
        ? {
            renderedPromptFingerprint: fingerprintEvalValue(
              renderedPromptIdentity.fingerprintMaterial,
            ),
          }
        : {}),
      capturedSignals: Object.freeze([...signals.captured]),
      runIds: Object.freeze([observation.runId]),
      metrics: Object.freeze({
        durationMs: Math.max(0, now() - startedAt),
        ...(typeof costUsd === "number" &&
        Number.isFinite(costUsd) &&
        costUsd >= 0
          ? { costUsd }
          : {}),
      }),
    });
  } catch (error) {
    observation.error(error);
    throw error;
  }
}

/** Execute an authored opaque callable inside a real Eval observability run. */
export async function executeObservedOpaqueTaskForInternalUse(
  request: EvalTaskHostRequest,
  now: () => number = Date.now,
): Promise<EvalTaskHostResult> {
  return runWithinEvalScopes(request.evalId, request, () =>
    executeObservedOpaqueTask(request, now),
  );
}

async function executeObservedOpaqueTask(
  request: EvalTaskHostRequest,
  now: () => number,
): Promise<EvalTaskHostResult> {
  if (typeof request.task !== "function") {
    throw new TypeError("Eval task must be callable.");
  }
  const task = request.task;
  const startedAt = now();
  const capture = requireEvalCaptureSession();
  const observation = openEvalCellObservabilityRun(request);
  try {
    const output = await observation.withContext(() =>
      request.call === undefined
        ? task(request.input)
        : task(request.input, request.call),
    );
    observation.ok();
    await capture.settle();
    const signals = extractCellSignals(capture.take(observation.runId));
    return Object.freeze({
      output,
      capturedSignals: Object.freeze([...signals.captured]),
      runIds: Object.freeze([observation.runId]),
      metrics: Object.freeze({
        durationMs: Math.max(0, now() - startedAt),
        ...(signals.costUsd !== undefined ? { costUsd: signals.costUsd } : {}),
      }),
      observedIdentity: Object.freeze({
        reusable: false as const,
        reason: "identity_unavailable" as const,
      }),
    });
  } catch (error) {
    observation.error(error);
    throw error;
  }
}

function requireEvalCaptureSession() {
  const capture = currentEvalCaptureSession();
  if (capture) return capture;
  throw new TypeError("Observed Eval tasks require an active eval-run scope.");
}
