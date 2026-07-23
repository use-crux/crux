/**
 * Reference and recursion detection.
 *
 * Zod v4 inlines non-recursive reused schemas, so a `$ref` in the canonical tree
 * always indicates recursion. This module detects that so the compiler can
 * reject recursive schemas when the profile does not support them.
 *
 * @module
 */

import type { JsonSchemaObject } from "./plan";

/** Whether the canonical schema tree contains any `$ref` (i.e. recursion). */
export function schemaHasReference(node: unknown): boolean {
  if (Array.isArray(node)) {
    return node.some(schemaHasReference);
  }
  if (node === null || typeof node !== "object") return false;
  const record = node as JsonSchemaObject;
  if (typeof record.$ref === "string") return true;
  for (const value of Object.values(record)) {
    if (schemaHasReference(value)) return true;
  }
  return false;
}
