/** JSON/schema projection helpers for managed AI task identity. @internal */

import { z } from "zod";
import type { JsonValue } from "@use-crux/core";
import type { EvalTaskIdentityProjection } from "@use-crux/core/eval/internal/task";

export type IdentityReason = Extract<
  EvalTaskIdentityProjection,
  { reusable: false }
>["reason"];

export type JsonProjection =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly reason: IdentityReason };

export function projectSchema(schema: unknown): JsonProjection {
  if (schema === undefined) return { ok: true, value: null };
  if (!isObject(schema) || !("_zod" in schema)) {
    return unavailable("identity_unavailable");
  }
  try {
    return projectJson(z.toJSONSchema(schema as z.ZodType));
  } catch {
    return unavailable("identity_unavailable");
  }
}

export function projectTools(value: unknown): JsonProjection {
  if (value === undefined) return { ok: true, value: Object.freeze([]) };
  if (!isRecord(value)) return unavailable("identity_unavailable");
  const projected: JsonValue[] = [];
  for (const name of Object.keys(value).sort()) {
    const tool = value[name];
    if (!isRecord(tool)) return unavailable("identity_unavailable");
    if (typeof tool.execute === "function") {
      return unavailable("untracked_external_dependency");
    }
    const schema = projectSchema(tool.inputSchema ?? tool.parameters);
    if (!schema.ok) return schema;
    const entry = projectJson({
      name,
      description:
        typeof tool.description === "string" ? tool.description : null,
      parameters: schema.value,
    });
    if (!entry.ok) return entry;
    projected.push(entry.value);
  }
  return { ok: true, value: Object.freeze(projected) };
}

export function projectPolicies(
  value: unknown,
  kind: "constraint" | "guardrail",
): JsonProjection {
  if (value === undefined) return { ok: true, value: Object.freeze([]) };
  if (!Array.isArray(value)) return unavailable("identity_unavailable");
  const projected: JsonValue[] = [];
  for (const policy of value) {
    if (!isRecord(policy) || !isRecord(policy.strategy)) {
      return unavailable("untracked_external_dependency");
    }
    const identity = projectJson({
      kind,
      id: policy.id,
      on: policy.on,
      category: policy.category ?? null,
      severity: policy.severity ?? null,
      mode: policy.mode ?? null,
      maxRetries: policy.maxRetries ?? null,
      stream: policy.stream ?? null,
      strategy: policy.strategy,
    });
    if (!identity.ok) return identity;
    projected.push(identity.value);
  }
  return { ok: true, value: Object.freeze(projected) };
}

export function projectJson(value: unknown): JsonProjection {
  return projectJsonValue(value, new WeakSet<object>());
}

function projectJsonValue(
  value: unknown,
  seen: WeakSet<object>,
): JsonProjection {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return { ok: true, value };
  }
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? { ok: true, value }
      : unavailable("identity_unavailable");
  }
  if (
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer ||
    (typeof Blob !== "undefined" && value instanceof Blob) ||
    value instanceof URL
  ) {
    return unavailable("implicit_media");
  }
  if (typeof value !== "object" || value === undefined) {
    return unavailable("identity_unavailable");
  }
  if (seen.has(value)) return unavailable("identity_unavailable");
  seen.add(value);
  if (Array.isArray(value)) {
    const result: JsonValue[] = [];
    for (const entry of value) {
      const projected = projectJsonValue(entry, seen);
      if (!projected.ok) return projected;
      result.push(projected.value);
    }
    seen.delete(value);
    return { ok: true, value: Object.freeze(result) };
  }
  if (!isRecord(value)) return unavailable("identity_unavailable");
  if (
    typeof value.type === "string" &&
    ["data", "url", "provider-file"].includes(value.type) &&
    value.contentHash === undefined &&
    value.sha256 === undefined &&
    value.ref === undefined
  ) {
    return unavailable("implicit_media");
  }
  const result: Record<string, JsonValue> = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) continue;
    const projected = projectJsonValue(value[key], seen);
    if (!projected.ok) return projected;
    result[key] = projected.value;
  }
  seen.delete(value);
  return { ok: true, value: Object.freeze(result) };
}

export function unavailable(
  reason: IdentityReason,
): Extract<JsonProjection, { readonly ok: false }> {
  return Object.freeze({ ok: false, reason });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isObject(value: unknown): value is object {
  return value !== null && typeof value === "object";
}
