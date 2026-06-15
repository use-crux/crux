/**
 * Stable source resolver package entry point.
 *
 * The implementation lives under `source-resolver/` so source-map discovery,
 * trace-map lookup, function extraction, cache policy, and worker protocol
 * handling can remain focused and independently tested.
 *
 * @module
 */

export {
  SourceResolver,
  errorMessage,
  parseSourceResolverWorkerRequest,
  serializeSourceResolverWorkerResponse,
} from './source-resolver/index'
export type {
  ParsedSourceResolverWorkerRequest,
  ResolvedFnSource,
  ResolvedLocation,
  ResolvedSourceFrame,
  SourceFrameLine,
  SourceFrameLineRole,
  SourceFrameOptions,
  SourceFrameResolution,
  SourceFrameResolverKind,
  SourceFrameUnavailable,
  SourceFrameUnavailableReason,
  SourceLocation,
  SourceResolverOptions,
  SourceResolverWorkerRequest,
} from './source-resolver/index'
