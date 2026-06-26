/**
 * Deterministic Indexer Extension runtime.
 *
 * The runtime normalizes extension manifests, dispatches extractors and rules,
 * and converts extractor results into compiler-owned static facts. Package
 * loading and trust checks live in `extensions/loading`.
 *
 * @module
 */

export {
  createExtensionRegistry,
  extractorsForCall,
  type ExtensionRegistry,
  type RegisteredExtractor,
} from './registry'
export {
  checkExtensionRules,
  createExtractContext,
  createIndexerExtensionRuntime,
  extractedFactsFromStaticExtractionResult,
  staticFoundDefinitionFromStaticExtractionResult,
  type ExtensionRuleInput,
  type ExtensionRuleResult,
  type ExtensionRuntimeCapability,
  type ExtensionRuntimeManifest,
  type ExtractorIdentity,
  type IndexerExtensionRuntime,
  type StaticExtractionInput,
  type StaticExtractionProjectionInput,
  type StaticExtractionResult,
} from './engine'
export { extensionIdentity, runtimeResultFromExtractResult } from './results'
export { indexRuleAvailability } from './rule-availability'
export { runtimeManifestCacheInputs } from './manifest-cache-inputs'
