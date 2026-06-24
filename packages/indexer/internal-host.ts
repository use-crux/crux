/**
 * Private host entry point for Crux-owned workers and local runtime bridges.
 *
 * This subpath is intentionally separate from `@crux/indexer` and
 * `@crux/indexer/extensions`. It exposes compiler, static extraction, and
 * semantic backend internals needed by bundled Crux workers without presenting
 * them as public extension-authoring APIs.
 *
 * @module
 */

export {
  astIndexPatchFromCompilerResult,
  compileProjectIndex,
  createProjectIndexCompiler,
  projectIndexSnapshotFromCompilerResult,
  runtimeIndexPatchFromCompilerResult,
} from './indexer/compiler'
export { createStaticExtraction } from './indexer/static/extraction/engine'
export { staticDefinitionFiles } from './indexer/files'
export { createTypeScriptStaticSyntaxFrontend } from './indexer/static/syntax-record'
export {
  createSemanticIndexService,
  createTypeScriptSemanticBackend,
  typescriptSemanticBackendCapabilities,
  typescriptSemanticBackendIdentity,
  createNativeSemanticBackend,
  nativeSemanticBackendCapabilities,
  nativeSemanticBackendIdentity,
} from './indexer/semantic/service'

export type {
  ProjectIndexCompiler,
  ProjectIndexCompileMode,
  ProjectIndexCompilerInput,
  ProjectIndexCompilerResult,
} from './indexer/compiler'
export type { CompilerOwnedProjection, ProjectIndexCompilerProfile } from './indexer/compiler/profile'
export type {
  SourceReader,
  StaticExtractionEngine,
  StaticExtractionInstrumentation,
  StaticExtractionOptions,
  StaticFileExtraction,
  StaticParseCacheHit,
  StaticParseCacheStore,
} from './indexer/static/extraction/engine'
export type {
  ProvidedStaticSyntaxRecordProvider,
  StaticSyntaxFrontendFactory,
} from './indexer/static/syntax-record'
export type {
  SemanticAnalyzeInput,
  SemanticAnalyzeResult,
  SemanticBackend,
  SemanticBackendCapabilities,
  SemanticBackendIdentity,
  SemanticBackendOption,
  SemanticBackendSelectionEnv,
  SemanticBackendSession,
  SemanticBackendSessionInput,
  SemanticCompilerDeclaration,
  SemanticCompilerNode,
  SemanticCompilerSourceFile,
  SemanticCompilerSymbol,
  SemanticCompilerType,
  SemanticCompilerView,
  SemanticEvidenceBatch,
  SemanticEvidenceBatchKind,
  SemanticEvidenceBatchSource,
  SemanticIndexService,
  SemanticIndexServiceOptions,
  SemanticProjectSessionIdentity,
  TypeScriptSemanticBackendOptions,
  NativeSemanticBackendOptions,
} from './indexer/semantic/service'
