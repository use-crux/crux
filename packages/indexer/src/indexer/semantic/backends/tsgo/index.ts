/**
 * TypeScript-Go semantic backend.
 *
 * This module owns the experimental `tsgo` backend implementation behind the
 * existing native semantic selection API. It preserves the shared Semantic
 * Evidence contract: direct projectors are guarded optimizations, and
 * unsupported syntax routes through the complete tsgo shared-analyzer path
 * instead of emitting partial backend-only facts.
 *
 * @module
 */

export {
  createNativeSemanticBackend,
  nativeSemanticBackendCapabilities,
  nativeSemanticBackendIdentity,
  type NativeSemanticBackendOptions,
} from './backend'
export { createTsgoNativeSemanticEngine, type TsgoNativeSemanticEngineInput } from './engine'
export { resolveTsgoExecutablePath } from './executable'
export { createTsgoSemanticCompilerHost, type TsgoSemanticCompilerHost } from './compiler-session'
export { createTsgoCompilerView, type TsgoSemanticCompilerView } from './compiler-view'
export { createTsgoProjectConfig, type TsgoProjectConfig } from './project-config'
export { createTsgoNativeSourceLookup, type TsgoNativeSourceLookup } from './source-lookup'
export { createTsgoSemanticSyntaxView, type TsgoSemanticSyntaxView } from './syntax-view'
