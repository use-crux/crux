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
  inspectProjectStaticIndexConfig,
  inspectProjectStaticSyntaxPlan,
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
  InspectProjectStaticIndexConfigOptions,
  InspectProjectStaticSyntaxPlanOptions,
  ProjectStaticIndexConfig,
  ProjectStaticIndexExtensionReference,
  ProjectStaticSyntaxPlan,
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
export { indexProjectRuntimeForHost, runtimeIndexPatchFromCompilerResult } from './runtime'
export type { IndexProjectRuntimeHostOptions } from './runtime'
export {
  diffRuntimeArtifactDrift,
  generateRuntimeArtifacts,
  manifestFromDefinitions,
} from '../indexer/runtime-artifacts'
export { runRuntimeOperation } from '../indexer/runtime-ops'
export type {
  GenerateRuntimeArtifactsOptions,
  RuntimeArtifactDriftReport,
  RuntimeArtifactGenerationResult,
  RuntimeArtifactMissingTarget,
} from '../indexer/runtime-artifacts'
export type {
  RuntimeOperationKind,
  RuntimeOperationOptions,
  RuntimeOperationResult,
} from '../indexer/runtime-ops'
export type { ResolveProjectModelOptions } from '../indexer/project-model'
export { resolveProjectModel } from '../indexer/project-model'
export type {
  InspectProjectConfigOptions,
  ProjectConfigFileOrigin,
  ProjectConfigFileStatus,
  ProjectConfigInspect,
  ProjectConfigList,
  ProjectConfigOrigin,
  ProjectConfigSetting,
} from '../indexer/project-config-inspect'
export { inspectProjectConfig } from '../indexer/project-config-inspect'
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
