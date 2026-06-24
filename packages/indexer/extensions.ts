/**
 * Experimental Crux Indexer extension boundary.
 *
 * This surface is intentionally small: extension authors describe facts they can prove from a
 * parser-owned source match, and the Project Index Compiler owns traversal, ordering, validation,
 * relation resolution, cache identity, and output projection.
 *
 * Third-party packages are loaded only through an explicit trust policy. Resolution preflights the
 * configured package name before `import(...)`, checks installed package metadata, and then passes
 * the manifest through the same deterministic extension runtime used by first-party extractors.
 *
 * Treat this subpath as experimental until the third-party loading, trust, versioning, and fixture
 * package contract is finalized.
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
  InstalledIndexerExtension,
  LoadIndexerExtensionReferencesInput,
  ResolvedIndexerExtension,
  ResolveIndexerExtensionReferencesInput,
  ResolveIndexerExtensionReferencesResult,
} from './indexer/extensions'
export type { IndexerExtensionManifestValidation } from './indexer/extensions/loading/manifest'
import type {
  IndexExtractor as InternalIndexExtractor,
  DefinitionBuilder,
  ExtensionIdentity,
  ExtractMatch,
  IndexerExtension as InternalIndexerExtension,
  ReferenceBuilder,
  SourceRefBuilder,
  SourceView,
  ArgumentReader,
  ConfigCallReader,
  ConfigReader,
} from './indexer/extensions'

export type {
  ArgumentReader,
  ConfigCallReader,
  ConfigReader,
  DefinitionBuilder,
  DefinitionBuilderInput,
  ExtensionIdentity,
  ExtensionReference,
  ExtensionTrustMode,
  ExtensionTrustPolicy,
  ExtractMatch,
  ExtractPattern,
  ExtractResult,
  ExtractedDefinition,
  ExtractedFacts,
  ExtractedSourceRef,
  IndexDependency,
  IndexerCompatibility,
  IndexerExtensionConfig,
  IndexRule,
  IndexRuleContext,
  RelationSpec,
  ReferenceBuilder,
  SemanticReadModel,
  SemanticSymbol,
  SemanticType,
  SourceView,
  SourceReference,
  SourceRefBuilder,
  UnresolvedReference,
} from './indexer/extensions'

export type {
  IndexFactKind,
  IndexRuleBudget,
  IndexRuleFidelity,
  IndexRuleManifest,
  IndexRulePhase,
} from '@crux/core/project-index'

/**
 * Stable extractor context exposed by the experimental public authoring barrel.
 *
 * Extractors receive one context per parser match. The context exposes conservative readers and
 * builders rather than raw TypeScript nodes so extractor code can stay deterministic, cacheable, and
 * portable across future parser implementations.
 *
 * Read from `args`, `config`, and `source`; build returned facts with `define`, `ref`, and
 * `sourceRef`. Do not mutate compiler state, retain the context after `extract(...)` returns, or
 * depend on file-system/global process state.
 */
export interface ExtractContext {
  /** Identity of the extension that owns the running extractor. */
  readonly extension: ExtensionIdentity
  /** Name of the running extractor inside its extension. */
  readonly extractor: string
  /** Parser match that caused this extractor invocation. */
  readonly match: ExtractMatch
  /** Stable source-local identity and file information for the matched source. */
  readonly source: SourceView
  /** Conservative reader for positional call or constructor arguments. */
  readonly args: ArgumentReader
  /** Conservative reader for the selected object/config argument, when one is statically visible. */
  readonly config: ConfigReader | undefined
  /** Definition builder bound to compiler-owned source and metadata defaults. */
  readonly define: DefinitionBuilder
  /** Builder for unresolved relation references. */
  readonly ref: ReferenceBuilder
  /** Builder for supplemental source references. */
  readonly sourceRef: SourceRefBuilder
}

/**
 * Source-local fact extractor exposed to extension authors.
 *
 * An extractor is a pure source-to-facts function. It may return:
 *
 * - `facts(...)` when it can prove definitions, references, source refs, or diagnostics
 * - `none()` when the parser match is valid but not meaningful for this extractor
 * - a degraded result when it can emit partial facts and explain the missing evidence
 *
 * Cross-file linking, linting, cache invalidation, and snapshot emission belong to later compiler
 * phases, not extractor code.
 */
export interface IndexExtractor extends Omit<InternalIndexExtractor, 'extract'> {
  /** Converts one parser-owned source match into immutable compiler facts. */
  extract(ctx: ExtractContext): ReturnType<InternalIndexExtractor['extract']>
}

/**
 * Experimental public extension manifest.
 *
 * Manifests are data, not registration side effects. Importing a manifest should not mutate global
 * compiler state, start workers, read project files, or patch runtime behavior.
 *
 * V1 public authoring is intentionally limited to extractors, relation specs, and rule declarations.
 * Compiler profiles, parser construction, custom source discovery, raw AST traversal, emitters,
 * query scheduling, and dynamic package loading remain internal until Crux is ready to support a
 * stable external extension ecosystem.
 */
export interface IndexerExtension
  extends Pick<InternalIndexerExtension, 'name' | 'version' | 'crux' | 'relations' | 'rules'> {
  /** Extractors contributed by this extension. */
  readonly extractors?: readonly IndexExtractor[]
}
