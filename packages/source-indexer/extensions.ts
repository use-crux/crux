/**
 * Experimental Source Indexer extension boundary.
 *
 * This surface exists so first-party indexer internals can migrate onto the
 * role-based Project Catalog Compiler model before third-party plugin loading is
 * stabilized. Treat these types and helpers as experimental.
 */
export {
  callPattern,
  createExtensionRegistry,
  createStaticExtensionRegistry,
  facts,
  legacyCatalogExtractor,
  newPattern,
  none,
  patternCallNames,
  projectDefinition,
  relationSpecFromPolicy,
  resolveStaticRelationReferences,
  validateRelationSpecs,
} from './indexer/extensions'
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
} from './indexer/extensions'
