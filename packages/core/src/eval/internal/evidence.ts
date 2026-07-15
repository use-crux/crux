/** Portable exact task-evidence records and validation. @internal */

import { OUTPUT_CACHE_EPOCH, isReusableEvalValue } from "./identity";
import type { EvalTaskExecutionEvidence, EvalTaskHostResult } from "./types";

export interface EvalTaskEvidenceEntry {
  readonly schemaVersion: 1;
  readonly outputCacheEpoch: typeof OUTPUT_CACHE_EPOCH;
  readonly status: "complete";
  readonly key: string;
  readonly fingerprint: string;
  readonly result: EvalTaskExecutionEvidence;
}

/** Create reusable evidence only for complete, durably identifiable values. */
export function createTaskEvidenceEntry(
  key: string,
  result: EvalTaskHostResult,
): EvalTaskEvidenceEntry | undefined {
  if (
    !isReusableEvalValue(result.output) ||
    !isReusableEvalValue(result.response) ||
    result.response.pendingApprovals !== undefined
  ) {
    return undefined;
  }
  return freezeEntry({
    schemaVersion: 1,
    outputCacheEpoch: OUTPUT_CACHE_EPOCH,
    status: "complete",
    key,
    fingerprint: key,
    result: executionEvidence(result),
  });
}

/** Treat every malformed, stale, non-complete, or wrong-key record as a miss. */
export function readTaskEvidenceEntry(
  value: unknown,
  expectedKey: string,
): EvalTaskEvidenceEntry | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value.schemaVersion !== 1 ||
    value.outputCacheEpoch !== OUTPUT_CACHE_EPOCH ||
    value.status !== "complete" ||
    value.key !== expectedKey ||
    value.fingerprint !== expectedKey ||
    !isTaskExecutionEvidence(value.result) ||
    !isReusableEvalValue(value.result.output) ||
    !isReusableEvalValue(value.result.response)
  ) {
    return undefined;
  }
  return freezeEntry(value as unknown as EvalTaskEvidenceEntry);
}

function freezeEntry(entry: EvalTaskEvidenceEntry): EvalTaskEvidenceEntry {
  return Object.freeze({
    ...entry,
    result: Object.freeze({
      ...entry.result,
      response: Object.freeze({
        ...entry.result.response,
        content: Object.freeze([...entry.result.response.content]),
        steps: Object.freeze([...entry.result.response.steps]),
        finalStep: Object.freeze({ ...entry.result.response.finalStep }),
        messages: Object.freeze([...entry.result.response.messages]),
        warnings: Object.freeze([...entry.result.response.warnings]),
      }),
      capturedSignals: Object.freeze([...entry.result.capturedSignals]),
      runIds: Object.freeze([...entry.result.runIds]),
      metrics: Object.freeze({ ...entry.result.metrics }),
    }),
  });
}

function isTaskExecutionEvidence(
  value: unknown,
): value is EvalTaskExecutionEvidence {
  if (!isRecord(value) || !("output" in value)) return false;
  return (
    isCompleteResponse(value.response) &&
    Array.isArray(value.capturedSignals) &&
    value.capturedSignals.every(isCapability) &&
    Array.isArray(value.runIds) &&
    value.runIds.every((runId) => typeof runId === "string") &&
    isRecord(value.metrics) &&
    typeof value.metrics.durationMs === "number" &&
    Number.isFinite(value.metrics.durationMs) &&
    value.metrics.durationMs >= 0 &&
    (value.metrics.costUsd === undefined ||
      (typeof value.metrics.costUsd === "number" &&
        Number.isFinite(value.metrics.costUsd) &&
        value.metrics.costUsd >= 0))
  );
}

function executionEvidence(
  result: EvalTaskHostResult,
): EvalTaskExecutionEvidence {
  const { observedIdentity: _observedIdentity, ...evidence } = result;
  return evidence;
}

function isCompleteResponse(value: unknown): boolean {
  if (!isRecord(value) || value.pendingApprovals !== undefined) return false;
  return (
    Array.isArray(value.content) &&
    typeof value.text === "string" &&
    Array.isArray(value.steps) &&
    isRecord(value.finalStep) &&
    Array.isArray(value.messages) &&
    Array.isArray(value.warnings)
  );
}

function isCapability(value: unknown): boolean {
  return [
    "modelCalls",
    "toolCalls",
    "steps",
    "handoffs",
    "retrieval",
    "citations",
    "safety",
    "memory",
    "routing",
    "decisionReport",
  ].includes(String(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
