export { createDefinitionBuilder, createReferenceBuilder } from './builders'
export { facts, none, projectDefinition } from './facts'
export { callPattern, newPattern, patternCallNames } from './patterns'
export { relationSpecFromPolicy, validateRelationSpecs } from './relation-specs'
export { resolveStaticRelationReferences } from './resolvers'
export { createExtensionRegistry, extractorsForCall, type ExtensionRegistry, type RegisteredExtractor } from './registry'
export { createStaticExtensionRegistry, extractWithExtensionRegistry, legacyCatalogExtractor } from './static-adapter'
export type {
  CatalogEmitter,
  CatalogExtractor,
  CatalogResolver,
  CatalogRule,
  ExtractContext,
  ExtractPattern,
  ExtractResult,
  ExtractedDefinition,
  ExtractedFacts,
  IndexDependency,
  IndexQuery,
  RelationSpec,
  SourceIndexerExtension,
  StaticObjectReader,
  UnresolvedReference,
} from './types'
