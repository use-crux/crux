export { createDefinitionBuilder, createEmptySourceRefBuilder, createReferenceBuilder } from './public-contract/builders'
export { facts, none, projectDefinition } from './public-contract/facts'
export { callPattern, newPattern, patternCallNames } from './public-contract/patterns'
export { relationSpecFromPolicy, validateRelationSpecs } from './public-contract/relation-specs'
export { isIndexerExtensionAllowed, validateIndexerExtensionManifest } from './loading/manifest'
export {
  INDEXER_EXTENSION_API_VERSION,
  loadIndexerExtensionReferences,
  PROJECT_INDEX_SCHEMA_VERSION,
  resolveIndexerExtensionReferences,
  type InstalledIndexerExtension,
  type LoadIndexerExtensionReferencesInput,
  type ResolvedIndexerExtension,
  type ResolveIndexerExtensionReferencesInput,
  type ResolveIndexerExtensionReferencesResult,
} from './loading/references'
export {
  createExtensionRegistry,
  extractorsForCall,
  type ExtensionRegistry,
  type RegisteredExtractor,
} from './runtime/registry'
export {
  staticFoundDefinitionFromExtractedFacts,
  staticFoundDefinitionsFromExtractedFacts,
} from '../static-index/compatibility/syntax-record-bridge/normalizer'
export {
  createStaticRecordEvidenceReader,
  type StaticRecordEvidenceReaderInput,
} from '../static-index/extension-host/evidence/record-reader'
export {
  checkStaticRules,
  extractStaticEvidenceBatch,
  loadStaticExtensionHostManifest,
  type CheckStaticRulesInput,
  type CheckStaticRulesResult,
  type ExtractStaticEvidenceBatchInput,
  type ExtractStaticEvidenceBatchItemResult,
  type ExtractStaticEvidenceBatchResult,
  type LoadStaticExtensionHostManifestInput,
  type LoadStaticExtensionHostManifestResult,
  type StaticExtensionEvidenceExtractor,
  type StaticExtensionEvidenceJob,
  type StaticExtensionHostMethod,
  type StaticExtensionHostNodeReason,
  type StaticExtensionHostNodeReport,
  type StaticExtensionHostRuntimeInput,
  type StaticRuleGraphInput,
} from '../static-index/extension-host/evidence/host'
export {
  checkStaticRulesForProject,
  extractStaticEvidenceBatchForProject,
  loadStaticExtensionHostManifestForProject,
  type CheckStaticRulesForProjectInput,
  type ExtractStaticEvidenceBatchForProjectInput,
  type LoadStaticExtensionHostManifestForProjectInput,
  type StaticExtensionWorkerProjectInput,
} from '../static-index/extension-host/evidence/worker'
export type {
  StaticExtensionNativeFinalizeFacts,
  StaticExtensionNativeRelationRef,
} from '../static-index/extension-host/evidence/host-facts'
export { staticInterestManifestFromExtensions } from '../static-index/extension-host/evidence/interests'
export {
  createStaticExtensionRegistry,
  extractFactsWithExtensionRegistry,
} from '../static-index/compatibility/syntax-record-bridge/adapter'
export {
  createIndexerExtensionRuntime,
  checkExtensionRules,
  extractedFactsFromStaticExtractionResult,
  staticFoundDefinitionFromStaticExtractionResult,
  type ExtensionRuntimeCapability,
  type ExtensionRuntimeManifest,
  type ExtensionRuleInput,
  type ExtensionRuleResult,
  type ExtractorIdentity,
  type IndexerExtensionRuntime,
  type StaticExtractionProjectionInput,
  type StaticExtractionInput,
  type StaticExtractionResult,
} from './runtime/engine'
export type {
  StaticExtensionHostManifest,
  StaticExtractorHostMode,
  StaticExtractorHostPlan,
} from '../static-index/extension-host/host-plan/host-manifest'
export type { StaticRecordExtractionInput } from '../static-index/compatibility/syntax-record-bridge/runtime'
export type {
  IndexEmitter,
  IndexExtractor,
  IndexResolver,
  IndexRule,
  IndexRuleContext,
  AnalysisTier,
  ConfigCallReader,
  ConfigReader,
  ConfiguredObjectReader,
  DefinitionBuilder,
  DefinitionBuilderInput,
  ExtensionIdentity,
  ExtensionReference,
  ExtensionTrustMode,
  ExtensionTrustPolicy,
  ExtractContext,
  ExtractMatch,
  ExtractPattern,
  ExtractResult,
  ExtractedDefinition,
  ExtractedFacts,
  ExtractedSourceRef,
  IndexDependency,
  IndexQuery,
  IndexerCompatibility,
  IndexerExtensionConfig,
  RelationSpec,
  ReferenceBuilder,
  ResolveContext,
  ResolveResult,
  SemanticReadModel,
  SemanticSymbol,
  SemanticType,
  SourceReference,
  IndexerExtension,
  SourceView,
  SourceRefBuilder,
  ArgumentReader,
  StaticArgumentReader,
  StaticCallObjectReader,
  StaticConfiguredObjectReader,
  StaticCallbackInterest,
  StaticCallbackSummary,
  StaticCallbackSummaryInput,
  StaticCallEvidenceQuery,
  StaticCallInterest,
  StaticConstructorEvidenceQuery,
  StaticConstructorInterest,
  StaticEvidenceInterestManifest,
  StaticEvidenceInterestSource,
  StaticEvidenceCompatibility,
  StaticEvidenceKind,
  StaticEvidenceMode,
  StaticEvidenceReader,
  StaticMatchEvidence,
  StaticObjectMapIdentifierEntry,
  StaticObjectReader,
  UnresolvedReference,
} from './public-contract/types'
