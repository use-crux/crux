/**
 * Canonical TypeScript contract for the native static compiler protocol.
 *
 * Native static is a Go/Rust acceleration lane, but TypeScript owns the
 * request, response, identity, telemetry, and validation schemas. Go and Rust
 * mirror these shapes and should round-trip shared fixtures from this spine.
 *
 * @module
 */

export type {
  NativeStaticCompilerMethod,
  NativeStaticCompilerRequest,
  NativeStaticCompilerResponse,
  NativeStaticFileInput,
  NativeStaticPreparedPlan,
  NativeStaticRunIdentity,
  NativeStaticSourceFile,
  NativeStaticTelemetry,
} from '../../worker-protocol/native-static'
export {
  NATIVE_STATIC_COMPILER_PROTOCOL_VERSION,
  NativeStaticAnalyzeRequestSchema,
  NativeStaticAnalyzeResponseSchema,
  NativeStaticCompileRequestSchema,
  NativeStaticCompileResponseSchema,
  NativeStaticCompilerRequestSchema,
  NativeStaticCompilerResponseSchema,
  NativeStaticFileInputSchema,
  NativeStaticFinalizeRequestSchema,
  NativeStaticFinalizeResponseSchema,
  NativeStaticPrepareRequestSchema,
  NativeStaticPrepareResponseSchema,
  NativeStaticPreparedPlanSchema,
  NativeStaticRunIdentitySchema,
  NativeStaticSourceFileSchema,
  NativeStaticTelemetrySchema,
} from '../../worker-protocol/native-static'
export type { ParsedNativeStaticCompilerRequest } from '../../worker-protocol/native-static-parse'
export { parseNativeStaticCompilerRequest } from '../../worker-protocol/native-static-parse'
export type {
  NativeStaticParserCallInterest,
  NativeStaticParserCallbackInterest,
  NativeStaticParserConstructorInterest,
} from '../../worker-protocol/native-static-parser-interests'
export {
  NativeStaticParserCallInterestSchema,
  NativeStaticParserCallbackInterestSchema,
  NativeStaticParserConstructorInterestSchema,
} from '../../worker-protocol/native-static-parser-interests'
