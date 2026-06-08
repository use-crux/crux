/**
 * Organized source resolver module.
 *
 * The root `../source-resolver.ts` file remains the stable package subpath.
 * This barrel exposes the documented resolver facade and helper modules for
 * package-local tests without changing the public npm export map.
 *
 * @module
 */

export { MAX_LOCATION_CACHE, locationCacheKey, putLocationCache } from './cache'
export { discoverSourceMap, normalizePath } from './discovery'
export { MAX_FN_EXTRACT_LINES, extractFunctionBody } from './extraction'
export { nodeSourceResolverFileSystem } from './filesystem'
export type { SourceResolverFileSystem } from './filesystem'
export { loadOriginalSource, resolveOriginalPath } from './original-source'
export { errorMessage, parseSourceResolverWorkerRequest, serializeSourceResolverWorkerResponse } from './protocol'
export type { ParsedSourceResolverWorkerRequest, SourceResolverWorkerRequest } from './protocol'
export { SourceResolver } from './resolver'
export type { SourceResolverOptions } from './resolver'
export { parseTraceMap, resolveOriginalPosition } from './trace-map'
export type {
  FunctionBodyExtraction,
  ResolvedFnSource,
  ResolvedLocation,
  SourceLocation,
  SourceMapDiscoveryFailure,
  SourceMapDiscoveryResult,
  SourcePosition,
  TraceMapResolutionFailure,
  TraceMapResolutionResult,
} from './types'
