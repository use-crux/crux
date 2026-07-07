/**
 * Crux Indexer SDK entry point.
 *
 * This barrel exposes extension-authoring primitives and stable record
 * contracts. Bundled first-party indexing is a Crux Local/CLI binary feature
 * implemented by the native Static Index pipeline.
 *
 * @module
 */

export {
  callPattern,
  facts,
  INDEXER_EXTENSION_API_VERSION,
  isIndexerExtensionAllowed,
  loadIndexerExtensionReferences,
  newPattern,
  none,
  PROJECT_INDEX_SCHEMA_VERSION,
  projectDefinition,
  resolveIndexerExtensionReferences,
  validateIndexerExtensionManifest,
} from './indexer/extensions'
export type {
  ArgumentReader,
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
  IndexerCompatibility,
  IndexerExtension,
  IndexerExtensionConfig,
  IndexRule,
  IndexRuleContext,
  InstalledIndexerExtension,
  LoadIndexerExtensionReferencesInput,
  RelationSpec,
  ReferenceBuilder,
  ResolvedIndexerExtension,
  ResolveIndexerExtensionReferencesInput,
  ResolveIndexerExtensionReferencesResult,
  SemanticReadModel,
  SemanticSymbol,
  SemanticType,
  SourceReference,
  SourceRefBuilder,
  SourceView,
  StaticObjectReader,
  StaticObjectMapIdentifierEntry,
  UnresolvedReference,
} from './indexer/extensions'
export type { IndexerExtensionManifestValidation } from './indexer/extensions/loading/manifest'
export type {
  IndexPatch,
  IndexPatchBudget,
  IndexPatchFacts,
  IndexPatchPhase,
  IndexPatchStatus,
} from './indexer/patches'
export type {
  SemanticBackendName,
  SemanticBackendSelection,
  SemanticSourceProfile,
  SemanticSourceProfileFile,
  SemanticSourceProfileHints,
} from './indexer/semantic/service'
export type {
  SemanticIndexInstrumentation,
  SemanticIndexTiming,
  SemanticIndexTimingName,
} from './indexer/semantic/instrumentation'
export type {
  StaticExtractionTiming,
  StaticExtractionTimingName,
} from './indexer/static/extraction/engine'
