import type { z } from "zod";
import type { BoundaryDef } from "../boundary";
import { SafetyStructuredSyncError } from "../errors";
import {
  resyncStructuredText,
  type StructuredSafetyOutput,
} from "../structured";

/** Resolve the exact terminal subject from synchronized text/object state. */
export function terminalSubject(
  boundary: BoundaryDef,
  state: StructuredSafetyOutput,
): unknown {
  if (boundary.id === "model.output.object") {
    return boundary.path ? valueAtPath(state.parsed, boundary.path) : state.parsed;
  }
  if (boundary.id === "model.output") {
    return { text: state.text, object: state.parsed };
  }
  return state.text;
}

/** Apply one enforcing rewrite and keep later terminal subjects synchronized. */
export function applyTerminalRewrite(
  boundary: BoundaryDef,
  state: StructuredSafetyOutput,
  value: unknown,
  options: { readonly schema?: z.ZodType; readonly policyId: string },
): StructuredSafetyOutput {
  let text: string;
  if (boundary.id === "model.output.object") {
    const parsed = boundary.path
      ? replaceAtPath(state.parsed, boundary.path, value, options.policyId)
      : value;
    text = serialize(parsed, options.policyId);
  } else if (
    boundary.id === "model.output" &&
    isRecord(value) &&
    typeof value.text === "string"
  ) {
    text = value.text;
  } else {
    text = typeof value === "string" ? value : serialize(value, options.policyId);
  }
  return resyncStructuredText(state, text, options);
}

function valueAtPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!isRecord(current) && !Array.isArray(current)) return undefined;
    return (current as Readonly<Record<string, unknown>>)[segment];
  }, value);
}

function replaceAtPath(
  value: unknown,
  path: string,
  replacement: unknown,
  policyId: string,
): unknown {
  const segments = path.split(".");
  const visit = (current: unknown, index: number): unknown => {
    if ((!isRecord(current) && !Array.isArray(current)) || index >= segments.length) {
      throw syncError(policyId, `cannot rewrite missing object path "${path}"`);
    }
    const segment = segments[index]!;
    const next =
      index === segments.length - 1
        ? replacement
        : visit((current as Readonly<Record<string, unknown>>)[segment], index + 1);
    if (Array.isArray(current)) {
      const numeric = Number(segment);
      if (!Number.isInteger(numeric)) {
        throw syncError(policyId, `cannot rewrite non-numeric array path "${path}"`);
      }
      const copy = [...current];
      copy[numeric] = next;
      return copy;
    }
    const copy: Record<string, unknown> = { ...current };
    copy[segment] = next;
    return copy;
  };
  return visit(value, 0);
}

function serialize(value: unknown, policyId: string): string {
  const text = JSON.stringify(value);
  if (typeof text !== "string") {
    throw syncError(policyId, "rewrite value is not JSON-serializable");
  }
  return text;
}

function syncError(policyId: string, problem: string): SafetyStructuredSyncError {
  return new SafetyStructuredSyncError({
    message: `Safety could not synchronize structured output: ${problem}.`,
    policyId,
    parseError: problem,
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}
