/**
 * Recognition, cloning, and rejection of authored tool input schema shapes.
 *
 * A tool's parameters can be a Zod schema, an AI SDK `jsonSchema(...)` wrapper, a
 * raw JSON Schema, or an unsupported shape (a deferred/Promise-backed schema, a
 * Standard Schema without a JSON Schema, an AI SDK lazy/function schema, or a
 * primitive). Each shape is either normalized to a JSON Schema (retaining any
 * authored validator) or rejected before any provider request with a precise,
 * actionable error — never left to fail incidentally in JSON serialization.
 *
 * @module
 */

import type { z } from "zod";
import {
  CruxUnsupportedStructuredOutputError,
  type JsonSchemaObject,
  type StructuredOutputCapabilities,
} from "../structured-output";
import {
  wrapAuthoredValidator,
  type SchemaValidate,
  type ToolInputValidator,
} from "./tool-input-validators";

/** A non-Zod tool schema normalized to a JSON Schema plus any authored validator. */
export interface NormalizedToolInputSchema {
  readonly jsonSchema: JsonSchemaObject;
  readonly validate?: ToolInputValidator;
}

/** Whether a value is a Zod v4 schema (structural check). */
export function isZodParameters(value: unknown): value is z.ZodType {
  return (
    value !== null &&
    typeof value === "object" &&
    "_zod" in (value as Record<string, unknown>)
  );
}

/**
 * Recognize a non-Zod tool schema, rejecting shapes core cannot soundly compile
 * before any provider request.
 *
 * @throws {CruxUnsupportedStructuredOutputError} For a lazy/function schema, a
 *   primitive, a deferred/Promise-backed schema, or a Standard Schema without a
 *   JSON Schema.
 */
export function normalizeToolInputSchema(
  parameters: unknown,
  capabilities: StructuredOutputCapabilities,
): NormalizedToolInputSchema {
  const reject = (reason: string): never => {
    throw new CruxUnsupportedStructuredOutputError(capabilities.id, reason);
  };

  // A lazy AI SDK schema is a function; a primitive is not a schema at all.
  // Both are rejected explicitly so they never reach `in`-operator or JSON
  // serialization and fail with an incidental error.
  if (typeof parameters === "function") {
    reject(
      "a lazy (function) tool input schema is not supported; resolve it to a schema before use",
    );
  }
  if (typeof parameters !== "object" || parameters === null) {
    reject("an unrecognized tool input schema was provided");
  }
  if (isThenable(parameters)) {
    reject("a deferred or Promise-based tool input schema is not supported");
  }
  const record = parameters as Record<string, unknown>;
  if (record["~standard"] !== undefined && !("jsonSchema" in record)) {
    reject("a Standard Schema tool input without a JSON Schema is not supported");
  }
  if ("jsonSchema" in record) {
    const inner = record.jsonSchema;
    if (isThenable(inner)) {
      reject("a deferred or Promise-based tool `jsonSchema` is not supported");
    }
    if (!inner || typeof inner !== "object" || Array.isArray(inner)) {
      reject("a tool `jsonSchema` wrapper must contain a JSON Schema object");
    }
    return {
      jsonSchema: inner as JsonSchemaObject,
      ...(typeof record.validate === "function"
        ? { validate: wrapAuthoredValidator(record.validate as SchemaValidate) }
        : {}),
    };
  }
  // A plain object with no wrapper is treated as a raw JSON Schema; the lowering
  // kernel rejects any construct it cannot soundly represent.
  return { jsonSchema: record as JsonSchemaObject };
}

/**
 * Deep-clone caller-owned JSON Schema data so lowering never mutates or freezes
 * the authored schema. JSON round-trip is sound here: a raw JSON Schema is plain
 * JSON data (any function/lazy shape was already rejected upstream).
 */
export function cloneJsonSchema(schema: JsonSchemaObject): JsonSchemaObject {
  return JSON.parse(JSON.stringify(schema)) as JsonSchemaObject;
}

/** Whether a value is Promise-like (a deferred schema). */
function isThenable(value: unknown): boolean {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}
