/**
 * Crux-owned Project Index host facades.
 *
 * Host modules are intentionally separate from the public root package and the
 * extension authoring surface. They are narrow bridges for bundled workers and
 * local runtime integrations that need compiler, semantic, runtime, or Static
 * Index compatibility-host capabilities.
 *
 * @module
 */

export {
  astIndexPatchFromCompilerResult,
  compileProjectIndex,
  createProjectIndexCompiler,
  projectIndexSnapshotFromCompilerResult,
  createStaticExtraction,
  staticDefinitionFiles,
  createTypeScriptStaticSyntaxFrontend,
  indexProjectAstFromSyntaxRecordProviderForHost,
  indexProjectAstFromSyntaxRecordsForHost,
} from './static-index'
export type {
  CompilerOwnedProjection,
  IndexProjectAstFromSyntaxRecordProviderHostOptions,
  IndexProjectAstFromSyntaxRecordsHostOptions,
  NativeFactProjectionMode,
  ProjectIndexCompileMode,
  ProjectIndexCompiler,
  ProjectIndexCompilerInput,
  ProjectIndexCompilerProfile,
  ProjectIndexCompilerResult,
  ProvidedStaticSyntaxRecordProvider,
  SourceReader,
  StaticExtractionEngine,
  StaticExtractionInstrumentation,
  StaticExtractionOptions,
  StaticFileExtraction,
  StaticParseCacheHit,
  StaticParseCacheStore,
  StaticSyntaxFileRecord,
  StaticSyntaxFrontendFactory,
  StaticSyntaxFrontendIdentity,
} from './static-index'
export {
  createNativeSemanticBackend,
  createSemanticIndexService,
  createTypeScriptSemanticBackend,
  nativeSemanticBackendCapabilities,
  nativeSemanticBackendIdentity,
  typescriptSemanticBackendCapabilities,
  typescriptSemanticBackendIdentity,
} from './semantic'
export type {
  NativeSemanticBackendOptions,
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
  SemanticSyntaxKind,
  SemanticSyntaxNode,
  SemanticSyntaxNodeOf,
  SemanticSyntaxSourceFile,
  SemanticSyntaxView,
  TypeScriptSemanticBackendOptions,
} from './semantic'
export { runtimeIndexPatchFromCompilerResult } from './runtime'
export {
  checkStaticRulesForProject,
  extractStaticEvidenceBatchForProject,
  loadStaticExtensionHostManifestForProject,
} from './static-compat'
export type {
  CheckStaticRulesForProjectInput,
  CheckStaticRulesInput,
  CheckStaticRulesResult,
  ExtractStaticEvidenceBatchForProjectInput,
  ExtractStaticEvidenceBatchInput,
  ExtractStaticEvidenceBatchResult,
  LoadStaticExtensionHostManifestForProjectInput,
  LoadStaticExtensionHostManifestInput,
  LoadStaticExtensionHostManifestResult,
  StaticIndexExtensionHostProjectInput,
  StaticExtensionWorkerProjectInput,
} from './static-compat'
