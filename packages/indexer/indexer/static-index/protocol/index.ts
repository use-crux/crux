/**
 * Static Index compiler protocol entry point.
 *
 * This barrel is the TypeScript-owned schema surface for source-only compiler
 * handoff. It re-exports request, response, identity, telemetry, and parser
 * interest contracts without exposing implementation-specific AST objects.
 *
 * @module
 */

export type {
  CreateStaticIndexRunIdentityOptions,
  StaticIndexIdentityComponent,
  StaticIndexIdentityManifest,
  StaticIndexRunIdentity,
  StaticIndexRunIdentityFromManifest,
} from './identity'
export {
  createStaticIndexRunIdentity,
  STATIC_INDEX_COMPILER_PROTOCOL_VERSION,
  StaticIndexIdentityComponentSchema,
  StaticIndexIdentityManifestSchema,
  StaticIndexRunIdentitySchema,
} from './identity'
export type {
  ParsedStaticIndexCompilerRequest,
  StaticIndexCompilerMethod,
  StaticIndexCompilerRequest,
  StaticIndexFileInput,
  StaticIndexLintSuppression,
  StaticIndexPreparedPlan,
  StaticIndexSourceFile,
} from './request'
export {
  parseStaticIndexCompilerRequest,
  StaticIndexAnalyzeRequestSchema,
  StaticIndexCompileRequestSchema,
  StaticIndexCompilerRequestSchema,
  StaticIndexFileInputSchema,
  StaticIndexFinalizeRequestSchema,
  StaticIndexLintSuppressionSchema,
  StaticIndexPrepareRequestSchema,
  StaticIndexPreparedPlanSchema,
  StaticIndexSourceFileSchema,
} from './request'
export type { StaticIndexCompilerResponse } from './response'
export {
  StaticIndexAnalyzeResponseSchema,
  StaticIndexCompileResponseSchema,
  StaticIndexCompilerResponseSchema,
  StaticIndexFinalizeResponseSchema,
  StaticIndexPrepareResponseSchema,
} from './response'
export type {
  StaticIndexParserCallInterest,
  StaticIndexParserCallbackInterest,
  StaticIndexParserConstructorInterest,
} from './interests'
export {
  StaticIndexParserCallInterestSchema,
  StaticIndexParserCallbackInterestSchema,
  StaticIndexParserConstructorInterestSchema,
  staticIndexParserInterestFields,
} from './interests'
export type { StaticIndexTelemetry } from './telemetry'
export { StaticIndexTelemetrySchema } from './telemetry'
