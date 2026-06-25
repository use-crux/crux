/**
 * Semantic Index host facade.
 *
 * This module is for Crux-owned semantic worker processes. It keeps backend
 * selection, semantic service construction, and backend-neutral evidence types
 * behind one host-only entry point while preserving the rule that raw
 * TypeScript or native compiler objects do not cross the package boundary.
 *
 * @module
 */

export {
  createNativeSemanticBackend,
  createSemanticIndexService,
  createTypeScriptSemanticBackend,
  nativeSemanticBackendCapabilities,
  nativeSemanticBackendIdentity,
  typescriptSemanticBackendCapabilities,
  typescriptSemanticBackendIdentity,
} from '../indexer/semantic/service'

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
  TypeScriptSemanticBackendOptions,
} from '../indexer/semantic/service'

