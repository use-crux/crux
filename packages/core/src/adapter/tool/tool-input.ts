/**
 * Tool input compilation and decoding.
 *
 * Every tool input schema — Zod, an AI SDK `jsonSchema(...)` wrapper, or a raw
 * JSON Schema — is compiled by the same capability lowering kernel into a wire
 * schema and a reversible decode manifest. At execution the model's arguments
 * are decoded to canonical `z.input`, then validated exactly once by the tool's
 * authored validator (the Zod schema, or the AI SDK schema's own `validate`)
 * before the developer's `execute` runs on the validated/transformed value. Raw
 * JSON Schemas carry no authored validator (the provider validates structurally).
 *
 * Core stays provider-agnostic: schema shapes are recognized structurally
 * ({@link ./tool-input-normalize}) and validators are provider-neutral
 * ({@link ./tool-input-validators}); the AI SDK is never imported.
 *
 * @module
 */

import {
  compileCanonicalSchema,
  compileCanonicalSchemaPassthrough,
  compileStructuredOutput,
  compileStructuredOutputPassthrough,
  decodeStructuredValue,
  type StructuredOutputCapabilities,
  type StructuredOutputDecodeManifest,
  type JsonSchemaObject,
} from "../structured-output";
import {
  cloneJsonSchema,
  isZodParameters,
  normalizeToolInputSchema,
} from "./tool-input-normalize";
import { zodValidator, type ToolInputValidator } from "./tool-input-validators";

export {
  CruxToolInputValidationError,
  type ToolInputValidationOutcome,
  type ToolInputValidator,
} from "./tool-input-validators";
export { isZodParameters } from "./tool-input-normalize";

/**
 * Capabilities used to compile tool input schemas when the provider declares no
 * structured-output profile. Permissive: no optional lowering, no keyword drop —
 * the tool wire schema equals the canonical schema and the decode manifest is
 * empty.
 */
export const DEFAULT_TOOL_INPUT_CAPABILITIES: StructuredOutputCapabilities = {
  id: "tool-input.default",
  supportsJsonSchema: true,
  requiresAllProperties: false,
  supportsOptionalProperties: true,
  supportsNullable: true,
  supportsBooleanSchemas: true,
  supportsReferences: true,
  supportsUnions: true,
  supportsRecursiveSchemas: true,
  additionalProperties: "supported",
  unsupportedKeywords: [],
};

/** The compiled plan for one tool's input schema. */
export interface ToolInputPlan {
  /** Provider-compatible lowered wire schema sent to the provider. */
  readonly wireSchema: JsonSchemaObject;
  /** Reversible decode manifest applied to model arguments. */
  readonly manifest: StructuredOutputDecodeManifest;
  /**
   * Authored validator, when the tool declared a semantic schema (Zod or an AI
   * SDK schema with `validate`). Run once over decoded `z.input`; absent for a
   * raw JSON Schema, which the provider validates structurally.
   */
  readonly validate?: ToolInputValidator;
  /**
   * Whether the tool declared any input schema (Zod, an AI SDK `jsonSchema(...)`
   * wrapper, or a raw JSON Schema). Tools with no schema keep an empty wire
   * schema and are not installed on the provider tool.
   */
  readonly hasAuthoredSchema: boolean;
}

/**
 * Compile a tool's parameters into a {@link ToolInputPlan}.
 *
 * Zod schemas are compiled from their canonical form and keep a Zod validator.
 * An AI SDK `jsonSchema(...)` wrapper is unwrapped and compiled, and its authored
 * `validate` (if any) is preserved as the validator. A raw JSON Schema is
 * compiled with no validator. Deferred/Promise-backed, Standard Schema, lazy
 * (function), primitive, and unrecognized shapes are rejected before provider
 * I/O.
 */
export function compileToolInputPlan(
  parameters: unknown,
  capabilities: StructuredOutputCapabilities,
  passthrough = false,
): ToolInputPlan {
  if (parameters === undefined || parameters === null) {
    return {
      wireSchema: {},
      manifest: { version: 1, operations: [] },
      hasAuthoredSchema: false,
    };
  }
  if (isZodParameters(parameters)) {
    const plan = passthrough
      ? compileStructuredOutputPassthrough(parameters)
      : compileStructuredOutput(parameters, capabilities);
    return {
      wireSchema: plan.outputSchema,
      manifest: plan.decodeManifest,
      validate: zodValidator(parameters),
      hasAuthoredSchema: true,
    };
  }
  // The caller-owned schema is deep-cloned before lowering + freezing so the
  // authored schema is never mutated or frozen.
  const normalized = normalizeToolInputSchema(parameters, capabilities);
  const cloned = cloneJsonSchema(normalized.jsonSchema);
  const plan = passthrough
    ? compileCanonicalSchemaPassthrough(cloned)
    : compileCanonicalSchema(cloned, capabilities, { rawSchema: true });
  return {
    wireSchema: plan.outputSchema,
    manifest: plan.decodeManifest,
    ...(normalized.validate ? { validate: normalized.validate } : {}),
    hasAuthoredSchema: true,
  };
}

/**
 * Decode model-supplied arguments to canonical `z.input` for a tool.
 *
 * Idempotent for already-decoded values, so it is safe to run both before the
 * tool gate (so policies see canonical input) and again at the execution
 * boundary.
 */
export function decodeToolArgs(args: unknown, plan: ToolInputPlan): unknown {
  return decodeStructuredValue(args, plan.manifest);
}
