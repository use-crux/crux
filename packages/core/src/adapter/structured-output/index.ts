/**
 * `structured-output` — provider-neutral structured-output compiler.
 *
 * Compiles one authored Zod schema against one inert provider capability profile
 * into an immutable plan (lowered wire schema, reversible decode manifest,
 * diagnostics, fingerprint), and decodes provider values back to canonical
 * `z.input`. Core owns the finite lowering rules; providers supply only data.
 *
 * @module
 */

export type {
  AdditionalPropertiesSupport,
  StructuredOutputCapabilities,
} from "./capabilities";
export type {
  JsonSchemaObject,
  StructuredOutputDecodeManifest,
  StructuredOutputDecodeOperation,
  StructuredOutputPlan,
} from "./plan";
export type {
  StructuredOutputDiagnostic,
  StructuredOutputDiagnosticCode,
} from "./diagnostics";
export {
  CruxInvalidCapabilityProfileError,
  CruxStructuredOutputDecodeError,
  CruxUnsupportedSchemaError,
  CruxUnsupportedStructuredOutputError,
} from "./errors";
export type { StructuredOutputErrorCode } from "./errors";
export { validateStructuredOutputCapabilities } from "./validate-profile";
export { toCanonicalJsonSchema } from "./canonical-schema";
export {
  STRUCTURED_OUTPUT_COMPILER_VERSION,
  STRUCTURED_OUTPUT_MANIFEST_VERSION,
  structuredOutputFingerprint,
} from "./identity";
export type { StructuredOutputFingerprintInput } from "./identity";
export { decodeStructuredValue } from "./decode";
export {
  compileCanonicalSchema,
  compileCanonicalSchemaPassthrough,
  compileStructuredOutput,
  compileStructuredOutputPassthrough,
} from "./compile";
export type {
  StructuredOutputResolution,
  StructuredOutputResolverContext,
  StructuredOutputStrategy,
} from "./plan";
export {
  compileResolvedStructuredOutputForRequest,
  compileStructuredOutputForRequest,
} from "./compile-for-request";
export type {
  StructuredOutputDiagnosticsSink,
  StructuredOutputRequestContext,
} from "./compile-for-request";
