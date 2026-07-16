/** Structural validation and owned-value normalization for Eval tasks. @internal */

import type { JsonValue } from "../../storage/types";
import type { EvalCapability } from "../task";
import type { EvalTaskDescriptor, EvalTaskIdentityProjection } from "./task";

export function isCompatibleEvalTaskDescriptor(
  value: unknown,
): value is EvalTaskDescriptor {
  if (value === null || typeof value !== "object" || !Object.isFrozen(value)) {
    return false;
  }
  const descriptor = value as Record<string, unknown>;
  return (
    descriptor._tag === "CruxEvalTaskDescriptor" &&
    (descriptor.operation === "generate" ||
      descriptor.operation === "stream") &&
    descriptor.adapterId === "ai-sdk" &&
    (descriptor.promptId === undefined ||
      typeof descriptor.promptId === "string") &&
    isOptionalSchema(descriptor.inputSchema) &&
    isOptionalSchema(descriptor.outputSchema) &&
    Array.isArray(descriptor.capabilities) &&
    Object.isFrozen(descriptor.capabilities) &&
    descriptor.capabilities.every(isEvalCapability) &&
    (descriptor.requiredHostCapabilities === undefined ||
      (Array.isArray(descriptor.requiredHostCapabilities) &&
        Object.isFrozen(descriptor.requiredHostCapabilities) &&
        descriptor.requiredHostCapabilities.every(isRequiredHostCapability))) &&
    isRecord(descriptor.defaults) &&
    Object.isFrozen(descriptor.defaults) &&
    Array.isArray(descriptor.overrideKeys) &&
    Object.isFrozen(descriptor.overrideKeys) &&
    descriptor.overrideKeys.every((key) => typeof key === "string") &&
    typeof descriptor.projectIdentity === "function" &&
    typeof descriptor.execute === "function" &&
    typeof descriptor.projectOutput === "function" &&
    typeof descriptor.projectResponse === "function"
  );
}

function isRequiredHostCapability(value: unknown): boolean {
  return (
    value === "asset-store" ||
    value === "record-store" ||
    value === "vector-store"
  );
}

export function normalizeEvalTaskIdentityProjection(
  value: EvalTaskIdentityProjection,
): EvalTaskIdentityProjection {
  if (value.reusable !== true) {
    return Object.freeze({
      reusable: false,
      reason: isIdentityReason(value.reason)
        ? value.reason
        : "identity_unavailable",
    });
  }
  const material = cloneJsonValue(value.fingerprintMaterial, new WeakSet());
  return material === undefined
    ? Object.freeze({
        reusable: false,
        reason: "identity_unavailable" as const,
      })
    : Object.freeze({ reusable: true as const, fingerprintMaterial: material });
}

function cloneJsonValue(
  value: unknown,
  seen: WeakSet<object>,
): JsonValue | undefined {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== "object" || seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    const entries = value.map((entry) => cloneJsonValue(entry, seen));
    return entries.some((entry) => entry === undefined)
      ? undefined
      : Object.freeze(entries as JsonValue[]);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const record: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalized = cloneJsonValue(entry, seen);
    if (normalized === undefined) return undefined;
    record[key] = normalized;
  }
  return Object.freeze(record);
}

function isIdentityReason(
  value: unknown,
): value is Extract<EvalTaskIdentityProjection, { reusable: false }>["reason"] {
  return (
    value === "identity_unavailable" ||
    value === "untracked_external_dependency" ||
    value === "implicit_media"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isOptionalSchema(value: unknown): boolean {
  if (value === undefined) return true;
  if (value === null || typeof value !== "object" || !("~standard" in value)) {
    return false;
  }
  const standard = value["~standard"];
  return (
    standard !== null &&
    typeof standard === "object" &&
    "version" in standard &&
    standard.version === 1 &&
    "vendor" in standard &&
    typeof standard.vendor === "string" &&
    "validate" in standard &&
    typeof standard.validate === "function"
  );
}

function isEvalCapability(value: unknown): value is EvalCapability {
  return (
    typeof value === "string" &&
    [
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
    ].includes(value)
  );
}
