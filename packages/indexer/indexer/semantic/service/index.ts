export type {
  SemanticAnalyzeInput,
  SemanticAnalyzeResult,
  SemanticBackend,
  SemanticBackendCapabilities,
  SemanticBackendIdentity,
  SemanticBackendName,
  SemanticBackendOption,
  SemanticBackendSelection,
  SemanticBackendSelectionEnv,
  SemanticBackendSession,
  SemanticBackendSessionInput,
  SemanticIndexFilesInput,
  SemanticIndexProjectInput,
  SemanticIndexService,
  SemanticIndexServiceOptions,
  SemanticProjectSessionIdentity,
  NativeSemanticBackendSelection,
  TypeScriptSemanticBackendSelection,
} from './types'
export type {
  SemanticCompilerNode,
  SemanticCompilerDeclaration,
  SemanticCompilerSourceFile,
  SemanticCompilerSymbol,
  SemanticCompilerType,
  SemanticCompilerView,
} from '../compiler-view'
export type {
  SemanticEvidenceBatch,
  SemanticEvidenceBatchKind,
  SemanticEvidenceBatchSource,
} from '../evidence/projection'
export type {
  SemanticSourceProfile,
  SemanticSourceProfileFile,
  SemanticSourceProfileHints,
} from '../source-profile'
export {
  collectProjectedSemanticEvidence,
  projectSemanticEvidenceBatches,
  semanticEvidenceBatchesFromFacts,
} from '../evidence/projection'
export {
  createSemanticBackendFromSelection,
  semanticBackendSelectionFromConfig,
  semanticBackendSelectionFromEnv,
  semanticBackendSelectionFromProjectConfig,
} from './backend-selection'
export { semanticProjectSessionIdentity } from './session'
export { createSemanticIndexService } from './service'
export {
  createTypeScriptSemanticBackend,
  typescriptSemanticBackendCapabilities,
  typescriptSemanticBackendIdentity,
  type TypeScriptSemanticBackendOptions,
} from '../typescript/backend'
export {
  createNativeSemanticBackend,
  nativeSemanticBackendCapabilities,
  nativeSemanticBackendIdentity,
  type NativeSemanticBackendOptions,
} from '../native/tsgo/backend'
