/**
 * Canonical JSON Schema creation.
 *
 * Derives a fresh canonical JSON Schema tree from an authored Zod schema using
 * Zod v4's built-in conversion, preserving descriptions and supported metadata.
 * Unsupported Zod semantics remain the original Zod parser's responsibility; the
 * canonical tree is the neutral input to provider capability lowering and is
 * never a replacement validation model.
 *
 * @module
 */

import { z } from "zod";
import type { JsonSchemaObject } from "./plan";

/**
 * Convert an authored Zod schema to a fresh canonical JSON Schema object.
 *
 * @param schema - The authored Zod output (or tool input) schema.
 * @returns A new JSON Schema object; the authored schema is never mutated.
 *
 * @remarks
 * Returns a distinct object on every call so downstream lowering can freeze or
 * transform it without affecting the authored schema.
 */
export function toCanonicalJsonSchema(schema: z.ZodType): JsonSchemaObject {
  return z.toJSONSchema(schema) as JsonSchemaObject;
}
