import type { ProjectSourceRef } from '@crux/core/project-index'
import type { StaticEvidenceCompatibility, StaticEvidenceInterestManifest } from './evidence-types'
import type { IndexExtractor } from './extractor-types'
import type { IndexEmitter, IndexQuery, IndexResolver, IndexRule, RelationSpec } from './resolver-rule-types'

/**
 * Runtime identity for the extension currently contributing facts.
 *
 * The compiler uses this identity in diagnostics, deterministic registry ordering, and future
 * extension-aware cache keys. It is intentionally just data so extractor execution remains pure.
 */
export interface ExtensionIdentity {
  /** Package-style name used in diagnostics, cache keys, and registry ordering. */
  readonly name: string
  /** Semver-like version string included in static parser cache invalidation. */
  readonly version: string
}

export type AnalysisTier = 'syntax' | 'index' | 'semantic'

export interface IndexerCompatibility {
  readonly indexer: string
  readonly projectIndexSchema?: number
}

export type ExtensionTrustMode = 'first-party-only' | 'allowlisted' | 'unsafe-local-dev'

export interface ExtensionTrustPolicy {
  readonly mode: ExtensionTrustMode
  readonly allow?: readonly string[]
  readonly deny?: readonly string[]
}

export interface ExtensionReference {
  readonly package: string
  readonly export?: string
  readonly version?: string
  readonly enabled?: boolean
  readonly options?: unknown
}

export interface IndexerExtensionConfig {
  readonly extensions?: readonly ExtensionReference[]
  readonly trust?: ExtensionTrustPolicy
  readonly rules?: Readonly<Record<string, unknown>>
}

export interface SourceReference {
  readonly file: string
  readonly line: number
  readonly column?: number
  readonly symbol?: string
}

export interface SemanticSymbol {
  readonly id: string
  readonly name: string
  readonly kind?: string
}

export interface SemanticType {
  readonly display: string
  readonly flags?: readonly string[]
}

export interface SemanticReadModel {
  readonly resolveSymbol: (ref: SourceReference) => SemanticSymbol | undefined
  readonly typeOf: (ref: SourceReference) => SemanticType | undefined
  readonly referencesOf: (symbol: SemanticSymbol) => readonly SourceReference[]
}

/**
 * Data-first manifest for contributing to the Project Index compiler.
 *
 * The v1 surface is intentionally experimental and first-party focused. Extractors are the only
 * contribution slot currently exercised by production static discovery. Resolver, rule, emitter, and
 * query slots are present so the architecture can grow without reshaping extension manifests, but
 * custom third-party loading and arbitrary output kinds are still reserved.
 *
 * Manifests should be deterministic values: importing an extension must not register global state,
 * mutate caches, or inspect the user's filesystem. The compiler owns execution order, validation,
 * cache invalidation, and projection into snapshots or patches.
 */
export interface IndexerExtension {
  /**
   * Stable extension identifier.
   *
   * Use a package-style name such as `@crux/core` or `@acme/index`. The registry sorts by this value,
   * diagnostics report it, and cache keys include it once extension loading becomes external.
   */
  readonly name: string
  /**
   * Version of the extension manifest and extractor behavior.
   *
   * Bump this when an extractor can produce different facts for the same source. The static cache uses
   * extension versions as invalidation input, so stale index facts are discarded when behavior changes.
   */
  readonly version: string
  /** Compatible Indexer and Project Index schema versions. Required for public third-party loading. */
  readonly crux?: IndexerCompatibility
  /**
   * Declarative static evidence interests for extension extraction and lint rules.
   *
   * These interests are serializable compiler input. They let Go/Rust/Node plan bounded syntax
   * evidence without exposing TypeScript, Oxc, or ESTree AST nodes to extension code.
   */
  readonly static?: {
    /**
     * Declares whether this extension can run from bounded evidence only.
     *
     * Omit this for compatibility with existing extractors; the compiler will then assume broad
     * syntax-record evidence may be required. New high-performance extensions should set
     * `{ mode: 'declared' }` and list every needed call/property/callback interest.
     */
    readonly evidence?: StaticEvidenceCompatibility
    readonly interests?: StaticEvidenceInterestManifest
  }
  /**
   * Extractors that convert matched source shapes into immutable index facts.
   *
   * This is the only slot production v1 static discovery currently executes. Extractors should be
   * source-local and side-effect free: read from `ExtractContext`, return `ExtractResult`, and let
   * resolver/rule/emitter stages handle linking and projection.
   */
  readonly extractors?: readonly IndexExtractor[]
  /**
   * Reserved resolver contributions for binding unresolved references into index relations.
   *
   * Built-in resolver behavior handles first-party static relations today. This slot is present so the
   * manifest matches normal compiler architecture, but custom resolver authoring is not yet stable.
   */
  readonly resolvers?: readonly IndexResolver[]
  /**
   * Reserved rule contributions for diagnostics or lint facts over resolved index facts.
   *
   * Rules should be pure analyses over their input index view. They should not mutate definitions,
   * relations, source rows, or snapshots.
   */
  readonly rules?: readonly IndexRule[]
  /**
   * Reserved emitter contributions for compiler-owned output artifacts.
   *
   * Emitters affect stable outputs such as snapshots, patches, source rows, and reports. They are kept
   * internal in v1 so external extensions cannot fork the index contract.
   */
  readonly emitters?: readonly IndexEmitter[]
  /**
   * Relation contracts owned or mirrored by this extension.
   *
   * Relation specs make edge semantics explicit before extractors emit references. Registry
   * construction validates them up front so malformed relation contracts fail before indexing work
   * begins.
   */
  readonly relations?: readonly RelationSpec[]
  /**
   * Reserved query declarations for future query-backed incremental execution.
   *
   * Queries are not public authoring API yet. They exist to keep the manifest compatible with compiler
   * architectures where cached computations declare stable ids and versions.
   */
  readonly queries?: readonly IndexQuery[]
}
