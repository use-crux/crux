/** Execute one managed task while retaining its real observability evidence. */

import {
  extractCellSignals,
  installSignalCapture,
  withSignalCapture,
} from "./execution-signals";
import { executeEvalTaskForInternalUse } from "./task";
import type { EvalTaskHostRequest, EvalTaskHostResult } from "./types";
import { observe } from "../../observability";
import { fingerprintEvalValue } from "./identity";

/** Shared local and deployed task path; declarations never masquerade as observations. */
export async function executeObservedEvalTaskForInternalUse(
  request: EvalTaskHostRequest,
  now: () => number = Date.now,
): Promise<EvalTaskHostResult> {
  const startedAt = now();
  const capture = installSignalCapture();
  try {
    const result = await withSignalCapture(capture, () =>
      executeEvalTaskForInternalUse(
        request.task as never,
        request.input as never,
        request.call as never,
        request.overrides,
      ),
    );
    await capture.settle();
    const runId = result.response.runId;
    const signals = extractCellSignals(capture.take(runId));
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
      runIds: Object.freeze([runId]),
      metrics: Object.freeze({
        durationMs: Math.max(0, now() - startedAt),
        ...(typeof costUsd === "number" &&
        Number.isFinite(costUsd) &&
        costUsd >= 0
          ? { costUsd }
          : {}),
      }),
    });
  } finally {
    capture.dispose();
  }
}

/** Execute an authored opaque callable inside a real Eval observability run. */
export async function executeObservedOpaqueTaskForInternalUse(
  request: EvalTaskHostRequest,
  now: () => number = Date.now,
): Promise<EvalTaskHostResult> {
  if (typeof request.task !== "function") {
    throw new TypeError("Eval task must be callable.");
  }
  const task = request.task;
  const startedAt = now();
  const capture = installSignalCapture();
  const run = observe.openRun({
    name: `${request.evalId}:${request.caseId}:${request.variant}`,
    rootPrimitive: "eval.case",
    attributes: {
      evalId: request.evalId,
      caseId: request.caseId,
      variant: request.variant,
      trial: request.trial,
    },
  });
  try {
    const output = await withSignalCapture(
      capture,
      async () =>
        await run.withContext(() =>
          request.call === undefined
            ? task(request.input)
            : task(request.input, request.call),
        ),
    );
    run.end();
    await capture.settle();
    const signals = extractCellSignals(capture.take(run.runId));
    return Object.freeze({
      output,
      capturedSignals: Object.freeze([...signals.captured]),
      runIds: Object.freeze([run.runId]),
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
    run.error(error);
    throw error;
  } finally {
    capture.dispose();
  }
}
