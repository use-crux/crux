export { createDefinitionBuilder, createEmptySourceRefBuilder, createReferenceBuilder } from './builders'
export { facts, none, projectDefinition } from './facts'
export { callPattern, newPattern, patternCallNames } from './patterns'
export { relationSpecFromPolicy, validateRelationSpecs } from './relation-specs'
export { resolveStaticRelationReferences } from './resolvers'
export {
  createExtensionRegistry,
  extractorsForCall,
  type ExtensionRegistry,
  type RegisteredExtractor,
} from './registry'
export { staticFoundDefinitionFromExtractedFacts, staticFoundDefinitionsFromExtractedFacts } from './static-normalizer'
export { createStaticExtensionRegistry, extractFactsWithExtensionRegistry } from './static-adapter'
export {
  createSourceIndexerExtensionRuntime,
  checkExtensionRules,
  extractedFactsFromStaticExtractionResult,
  resolveExtensionReferences,
  staticFoundDefinitionFromStaticExtractionResult,
  type ExtensionRuntimeCapability,
  type ExtensionRuntimeManifest,
  type ExtensionResolutionInput,
  type ExtensionResolutionResult,
  type ExtensionRuleInput,
  type ExtensionRuleResult,
  type ExtractorIdentity,
  type SourceIndexerExtensionRuntime,
  type StaticExtractionProjectionInput,
  type StaticExtractionInput,
  type StaticExtractionResult,
} from './runtime'
export type {
  CatalogEmitter,
  CatalogExtractor,
  CatalogResolver,
  CatalogRule,
  CatalogRuleContext,
  ConfigCallReader,
  ConfigReader,
  DefinitionBuilder,
  DefinitionBuilderInput,
  ExtensionIdentity,
  ExtractContext,
  ExtractMatch,
  ExtractPattern,
  ExtractResult,
  ExtractedDefinition,
  ExtractedFacts,
  ExtractedSourceRef,
  IndexDependency,
  IndexQuery,
  RelationSpec,
  ReferenceBuilder,
  ResolveContext,
  ResolveResult,
  SourceIndexerExtension,
  SourceView,
  SourceRefBuilder,
  ArgumentReader,
  StaticArgumentReader,
  StaticCallObjectReader,
  StaticObjectReader,
  UnresolvedReference,
} from './types'
