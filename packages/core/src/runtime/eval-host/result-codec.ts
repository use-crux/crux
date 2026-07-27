/** Canonical, strict codec for the private deployed Eval result wire. @internal */

import type { JsonValue } from "../../storage";
import type { EvalTaskHostResult } from "../../eval/internal/types";
import {
  CRUX_EVAL_HOST_PROTOCOL_V1,
  CRUX_EVAL_HOST_PROTOCOL_V2,
} from "./types";
import { assertRuntimeJsonValue } from "../engine/json-value";
import {
  isEvalHostResultIdentity,
  projectEvalHostResultIdentity,
} from "./result-identity";

const OUTER_KEYS = [
  "schemaVersion",
  "protocol",
  "jobId",
  "evalRunId",
  "output",
  "response",
  "capturedSignals",
  "runIds",
  "metrics",
  "renderedPromptFingerprint",
  "observedIdentity",
] as const;
const RESPONSE_KEYS = [
  "runId",
  "_meta",
  "content",
  "text",
  "object",
  "usage",
  "cost",
  "steps",
  "finalStep",
  "messages",
  "warnings",
  "providerMetadata",
  "routing",
  "pendingApprovals",
] as const;
const STEP_KEYS = [
  "content",
  "text",
  "usage",
  "toolCalls",
  "finishReason",
  "responseId",
  "modelId",
  "warnings",
  "providerMetadata",
] as const;
const CAPABILITIES = new Set([
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
]);
/** Build and validate the exact result envelope persisted by an Eval host. */
export function encodeEvalHostResult(input: {
  readonly jobId: string;
  readonly evalRunId: string;
  readonly evidence: EvalTaskHostResult;
}): JsonValue {
  const payload = {
    schemaVersion: 2,
    protocol: CRUX_EVAL_HOST_PROTOCOL_V2,
    jobId: input.jobId,
    evalRunId: input.evalRunId,
    ...input.evidence,
    renderedPromptFingerprint: input.evidence.renderedPromptFingerprint ?? null,
    observedIdentity: projectEvalHostResultIdentity(
      input.evidence.observedIdentity,
    ),
  };
  // Preserve Runtime's typed durable-media classification before applying the
  // stricter Eval wire shape checks.
  assertRuntimeJsonValue(payload, "eval result");
  decodeEvalHostResult(payload, input);
  return payload as unknown as JsonValue;
}

/** Decode one result only when it belongs to the expected admitted job. */
export function decodeEvalHostResult(
  value: unknown,
  expected: { readonly jobId: string; readonly evalRunId: string },
): EvalTaskHostResult {
  return decodeEvalHostResultV2(value, expected);
}

/** Decode one strict legacy V1 result belonging to the expected job. */
export function decodeEvalHostResultV1(
  value: unknown,
  expected: { readonly jobId: string; readonly evalRunId: string },
): EvalTaskHostResult {
  return decodeResult(value, expected, CRUX_EVAL_HOST_PROTOCOL_V1);
}

/** Decode one strict current V2 result belonging to the expected job. */
export function decodeEvalHostResultV2(
  value: unknown,
  expected: { readonly jobId: string; readonly evalRunId: string },
): EvalTaskHostResult {
  return decodeResult(value, expected, CRUX_EVAL_HOST_PROTOCOL_V2);
}

function decodeResult(
  value: unknown,
  expected: { readonly jobId: string; readonly evalRunId: string },
  protocol:
    | typeof CRUX_EVAL_HOST_PROTOCOL_V1
    | typeof CRUX_EVAL_HOST_PROTOCOL_V2,
): EvalTaskHostResult {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, OUTER_KEYS) ||
    !OUTER_KEYS.every(
      (key) => key === "renderedPromptFingerprint" || key in value,
    ) ||
    value.schemaVersion !== 2 ||
    value.protocol !== protocol ||
    value.jobId !== expected.jobId ||
    value.evalRunId !== expected.evalRunId ||
    !isJsonValue(value.output) ||
    !isResponse(value.response) ||
    !isStringArray(value.runIds) ||
    !isCapabilityArray(value.capturedSignals) ||
    !isMetrics(value.metrics) ||
    !isOptionalFingerprint(value.renderedPromptFingerprint) ||
    !isEvalHostResultIdentity(value.observedIdentity)
  ) {
    throw incompatible();
  }
  const identity = value.observedIdentity as Record<string, unknown>;
  return Object.freeze({
    output: value.output,
    response: value.response,
    capturedSignals: Object.freeze([...value.capturedSignals]),
    runIds: Object.freeze([...value.runIds]),
    metrics: Object.freeze({ ...value.metrics }),
    ...(typeof value.renderedPromptFingerprint === "string"
      ? { renderedPromptFingerprint: value.renderedPromptFingerprint }
      : {}),
    observedIdentity: Object.freeze({ ...identity }),
  }) as EvalTaskHostResult;
}

function isOptionalFingerprint(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && /^[a-f0-9]{64}$/u.test(value))
  );
}

function isResponse(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, RESPONSE_KEYS) &&
    typeof value.runId === "string" &&
    value.runId.length > 0 &&
    isOperationResultMeta(value._meta) &&
    Array.isArray(value.content) &&
    typeof value.text === "string" &&
    Array.isArray(value.steps) &&
    value.steps.every(isStep) &&
    isStep(value.finalStep) &&
    Array.isArray(value.messages) &&
    Array.isArray(value.warnings) &&
    isJsonValue(value)
  );
}

function isOperationResultMeta(value: unknown): boolean {
  return (
    isRecord(value) &&
    isJsonValue(value) &&
    typeof value.traceId === "string" &&
    /^[0-9a-f]{32}$/u.test(value.traceId) &&
    typeof value.spanId === "string" &&
    /^[0-9a-f]{16}$/u.test(value.spanId)
  );
}

function isStep(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, STEP_KEYS) &&
    Array.isArray(value.content) &&
    typeof value.text === "string" &&
    Array.isArray(value.warnings) &&
    optionalString(value.finishReason) &&
    optionalString(value.responseId) &&
    optionalString(value.modelId) &&
    isJsonValue(value)
  );
}

function isMetrics(value: unknown): value is {
  readonly durationMs: number;
  readonly costUsd?: number;
} {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["durationMs", "costUsd"]) &&
    finiteNonnegative(value.durationMs) &&
    (value.costUsd === undefined || finiteNonnegative(value.costUsd))
  );
}

function isJsonValue(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value))
    return value.every((entry) => isJsonValue(entry, seen));
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.values(value).every((entry) => isJsonValue(entry, seen));
}

function isCapabilityArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => CAPABILITIES.has(String(item)))
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function optionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function finiteNonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).length === keys.length && hasOnlyKeys(value, keys);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function incompatible(): TypeError {
  return new TypeError("Deployed Eval returned an incompatible result.");
}
