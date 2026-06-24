/**
 * TypeScript-Go native semantic backend.
 *
 * The native backend is experimental and must preserve the shared semantic
 * evidence contract. Unsupported syntax routes through the complete shared
 * analyzer path rather than emitting native-only partial facts.
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
export { createTsgoTypeScriptSourceCache, type TsgoTypeScriptSourceCache } from './source-cache'

