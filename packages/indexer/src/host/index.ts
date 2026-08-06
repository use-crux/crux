/**
 * Crux-owned Project Index host facades.
 *
 * Host modules are intentionally separate from the public root package and the
 * extension authoring surface. They are narrow bridges for bundled workers and
 * local runtime integrations that need semantic, runtime, config, or Static
 * Index extension-host capabilities.
 *
 * @module
 */

export {
  inspectProjectStaticIndexConfig,
  staticDefinitionFiles,
} from './static-index'
export type {
  InspectProjectStaticIndexConfigOptions,
  ProjectStaticIndexConfig,
  ProjectStaticIndexExtensionReference,
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
export { indexProjectRuntimeForHost, loadRuntimeWorkerHost } from './runtime'
export type { IndexProjectRuntimeHostOptions, LoadRuntimeWorkerHostOptions } from './runtime'
export {
  diffRuntimeArtifactDrift,
  generateRuntimeArtifacts,
  manifestFromDefinitions,
} from '../indexer/runtime-artifacts'
export { runRuntimeOperation } from '../indexer/runtime-ops'
export {
  runSetupOperation,
  runSetupPlanningOperation,
} from '../indexer/setup-ops'
export type { SetupCommandResult } from '../indexer/setup-ops'
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
/** @internal Used by the bundled Crux Local worker; not a root SDK export. */
export { createProjectIndexDeploymentManifest } from '../indexer/deployment-manifest'
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
