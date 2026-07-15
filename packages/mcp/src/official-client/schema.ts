import { z } from "zod";
import type * as ZodCore from "zod/v4/core";

/**
 * Convert a remotely advertised object JSON Schema to dynamic Zod validation.
 *
 * The SDK's protocol type intentionally permits extension keywords, while
 * Zod's converter accepts its narrower JSON Schema representation. The local
 * assertion bridges only that upstream type mismatch; the converted schema and
 * final record pipe validate every runtime value.
 */
export function mcpInputSchema(
  schema: Readonly<Record<string, unknown>>,
): z.ZodType<Record<string, unknown>> {
  return mcpObjectSchema(schema);
}

/** Compile an advertised output schema independently of SDK page caches. */
export function mcpOutputSchema(
  schema: Readonly<Record<string, unknown>>,
): z.ZodType<Record<string, unknown>> {
  return mcpObjectSchema(schema);
}

function mcpObjectSchema(
  schema: Readonly<Record<string, unknown>>,
): z.ZodType<Record<string, unknown>> {
  const converted = z.fromJSONSchema(schema as ZodCore.JSONSchema.JSONSchema);
  return converted.pipe(z.record(z.string(), z.unknown()));
}
