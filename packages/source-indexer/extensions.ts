/**
 * Experimental Source Indexer extension boundary.
 *
 * This surface exists so first-party indexer internals can migrate onto the
 * role-based Project Catalog Compiler model before third-party plugin loading is
 * stabilized. Treat these types and helpers as experimental.
 */
export { callPattern, facts, newPattern, none, projectDefinition } from './indexer/extensions'
import type {
  CatalogExtractor as InternalCatalogExtractor,
  ConfigCallReader,
  ConfigReader,
  ExtractContext as InternalExtractContext,
  SourceIndexerExtension as InternalSourceIndexerExtension,
  ArgumentReader,
} from './indexer/extensions'

export type {
  ArgumentReader,
  ConfigCallReader,
  ConfigReader,
  DefinitionBuilder,
  DefinitionBuilderInput,
  ExtensionIdentity,
  ExtractMatch,
  ExtractPattern,
  ExtractResult,
  ExtractedDefinition,
  ExtractedFacts,
  ExtractedSourceRef,
  IndexDependency,
  RelationSpec,
  ReferenceBuilder,
  SourceView,
  SourceRefBuilder,
  UnresolvedReference,
} from './indexer/extensions'

/**
 * Stable extractor context exposed by the experimental public authoring barrel.
 *
 * This facade keeps user-facing names focused on compiler roles (`args`, `config`, builders, source
 * views) while the fuller internal context can continue carrying first-party migration hooks.
 */
export interface ExtractContext extends Omit<InternalExtractContext, 'args' | 'config' | 'unstableNative'> {
  /** Conservative reader for positional call or constructor arguments. */
  readonly args: ArgumentReader
  /** Conservative reader for the selected object/config argument, when one is statically visible. */
  readonly config: ConfigReader | undefined
}

/**
 * Source-local fact extractor exposed to extension authors.
 *
 * Extractors should be pure functions of their context: read from `ctx`, build immutable facts, and
 * return an `ExtractResult` without mutating compiler state.
 */
export interface CatalogExtractor extends Omit<InternalCatalogExtractor, 'extract'> {
  /** Converts one parser-owned source match into immutable compiler facts. */
  extract(ctx: ExtractContext): ReturnType<InternalCatalogExtractor['extract']>
}

/**
 * Experimental public extension manifest.
 *
 * V1 public authoring is intentionally limited to extractors and relation specs. Compiler slots such
 * as custom resolvers, rules, emitters, queries, sources, and parsers remain internal until Crux is
 * ready to support stable external plugin loading.
 */
export interface SourceIndexerExtension extends Pick<InternalSourceIndexerExtension, 'name' | 'version' | 'relations'> {
  /** Extractors contributed by this extension. */
  readonly extractors?: readonly CatalogExtractor[]
}
