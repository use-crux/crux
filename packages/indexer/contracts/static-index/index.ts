/**
 * Static Index compiler protocol contract.
 *
 * This entry point owns the TypeScript-visible request, response, identity,
 * parser-interest, and telemetry shapes mirrored by the Go host and Rust
 * Static Index worker.
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
  StaticIndexIdentityManifest,
  StaticIndexLintSuppression,
  StaticIndexParserCallInterest,
  StaticIndexParserCallbackInterest,
  StaticIndexParserConstructorInterest,
  StaticIndexPreparedPlan,
  StaticIndexRunIdentity,
  StaticIndexSourceFile,
  StaticIndexTelemetry,
} from './schema'
export {
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
  StaticIndexIdentityManifestSchema,
  StaticIndexLintSuppressionSchema,
  StaticIndexParserCallInterestSchema,
  StaticIndexParserCallbackInterestSchema,
  StaticIndexParserConstructorInterestSchema,
  StaticIndexPrepareRequestSchema,
  StaticIndexPrepareResponseSchema,
  StaticIndexPreparedPlanSchema,
  StaticIndexRunIdentitySchema,
  StaticIndexSourceFileSchema,
  StaticIndexTelemetrySchema,
  createStaticIndexRunIdentity,
  parseStaticIndexCompilerRequest,
} from './schema'
export {
  staticIndexCompilerRequestFixtures,
  staticIndexCompilerResponseFixtures,
  staticIndexIdentityManifestFixture,
  staticIndexPreparedPlanFixture,
  staticIndexRunIdentityFixture,
  staticIndexSourceFileFixture,
  staticIndexTelemetryFixture,
} from './fixtures'
