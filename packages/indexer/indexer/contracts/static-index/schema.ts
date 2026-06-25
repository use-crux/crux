/**
 * Canonical TypeScript contract for the Static Index compiler protocol.
 *
 * Static Index is the source-only Project Index lane. TypeScript owns the
 * request, response, identity, telemetry, and validation schemas; Go and Rust
 * mirror these shapes and round-trip shared fixtures from this spine.
 *
 * @module
 */

export type {
  ParsedStaticIndexCompilerRequest,
  StaticIndexCompilerMethod,
  StaticIndexCompilerRequest,
  StaticIndexCompilerResponse,
  StaticIndexFileInput,
  StaticIndexIdentityComponent,
  StaticIndexParserCallInterest,
  StaticIndexParserCallbackInterest,
  StaticIndexParserConstructorInterest,
  StaticIndexPreparedPlan,
  StaticIndexRunIdentity,
  StaticIndexSourceFile,
  StaticIndexTelemetry,
} from '../../static-index/protocol'
export {
  parseStaticIndexCompilerRequest,
  STATIC_INDEX_COMPILER_PROTOCOL_VERSION,
  StaticIndexAnalyzeRequestSchema,
  StaticIndexAnalyzeResponseSchema,
  StaticIndexCompileRequestSchema,
  StaticIndexCompileResponseSchema,
  StaticIndexCompilerRequestSchema,
  StaticIndexCompilerResponseSchema,
  StaticIndexFileInputSchema,
  StaticIndexFinalizeRequestSchema,
  StaticIndexFinalizeResponseSchema,
  StaticIndexIdentityComponentSchema,
  StaticIndexParserCallInterestSchema,
  StaticIndexParserCallbackInterestSchema,
  StaticIndexParserConstructorInterestSchema,
  StaticIndexPrepareRequestSchema,
  StaticIndexPrepareResponseSchema,
  StaticIndexPreparedPlanSchema,
  StaticIndexRunIdentitySchema,
  StaticIndexSourceFileSchema,
  StaticIndexTelemetrySchema,
} from '../../static-index/protocol'
