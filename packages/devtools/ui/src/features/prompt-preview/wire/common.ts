import type { PromptPreviewEnvironment } from "../types";

export type WireObject = Readonly<Record<string, unknown>>;

export function wireObject(value: unknown): WireObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("expected object");
  }
  return value as WireObject;
}

export function exactWireKeys(
  value: WireObject,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    throw new Error("unexpected wire fields");
  }
}

export function wireString(
  value: unknown,
  minimum: number,
  maximum: number,
): string {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum ||
    hasUnpairedSurrogate(value)
  ) {
    throw new Error("invalid wire string");
  }
  return value;
}

export function optionalWireString(
  value: unknown,
  maximum: number,
): string | undefined {
  return value === undefined ? undefined : wireString(value, 1, maximum);
}

export function positiveSafeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error("invalid positive safe integer");
  }
  return value as number;
}

export function nonnegativeSafeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error("invalid nonnegative safe integer");
  }
  return value as number;
}

export function finiteNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("invalid finite number");
  }
  return value;
}

export function wireEnvironment(value: unknown): PromptPreviewEnvironment {
  switch (value) {
    case "node":
    case "convex":
    case "serverless":
    case "browser":
    case "unknown":
      return value;
    default:
      throw new Error("invalid environment");
  }
}

export function wireJsonObject(value: unknown): WireObject {
  const object = wireObject(value);
  validateJsonValue(object, 1, { nodes: 0 });
  return object;
}

function validateJsonValue(
  value: unknown,
  depth: number,
  state: { nodes: number },
): void {
  state.nodes += 1;
  if (state.nodes > 10_000 || depth > 32) throw new Error("JSON limit");
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (typeof value === "string") {
    wireString(value, 0, 65_536);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child) => validateJsonValue(child, depth + 1, state));
    return;
  }
  const object = wireObject(value);
  for (const [key, child] of Object.entries(object)) {
    wireString(key, 0, 256);
    validateJsonValue(child, depth + 1, state);
  }
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (!(low >= 0xdc00 && low <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}
