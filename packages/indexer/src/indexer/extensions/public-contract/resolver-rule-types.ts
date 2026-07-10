import type {
  IndexDiagnostic,
  IndexLintFinding,
  IndexRuleManifest,
  ProjectDefinition,
  ProjectRelation,
} from '@use-crux/core/project-index'
import type { SemanticReadModel } from './manifest-types'
import type { ExtractedSourceRef, IndexDependency, UnresolvedReference } from './extractor-types'

/**
 * Declares the semantics and validation envelope for a index relation type.
 *
 * Relation specs let the registry fail early when extensions declare duplicate or malformed relation
 * contracts. They also keep resolver behavior data-driven: extractors emit references, while relation
 * specs describe which resolved edges are meaningful and how they should be presented.
 */
export interface RelationSpec {
  /** Stable relation type, for example `agent.uses_tool`. */
  readonly type: string
  /** Optional allowed source definition kinds for validation and docs. */
  readonly fromKinds?: readonly string[]
  /** Optional allowed target definition kinds for validation and docs. */
  readonly toKinds?: readonly string[]
  /**
   * Where the relation should be visible in index consumers.
   *
   * `edge` relations are graph-first, `detail` relations are primarily explanatory metadata, and
   * `both` means consumers can show them in graph and detail views.
   */
  readonly presentation: 'edge' | 'detail' | 'both'
  /**
   * Confidence level for relations produced from this spec.
   *
   * `partial` relations can be useful before semantic analysis resolves all imports or runtime joins.
   */
  readonly fidelity?: 'partial' | 'resolved'
  /** Whether the relation participates in authored-to-runtime span/resource joining. */
  readonly runtimeJoin: boolean
}

/**
 * Reserved resolver slot for turning unresolved references into validated index relations.
 *
 * Production static indexing currently uses built-in resolver behavior. The type exists so relation
 * resolution can become an explicit extension phase without forcing extractors to change their return
 * shape.
 */
export interface IndexResolver {
  /** Stable resolver name used in diagnostics and future query/cache keys. */
  readonly name: string
  /** Resolves references against extracted definitions and returns new immutable facts. */
  resolve(ctx: ResolveContext): ResolveResult
}

/** Resolver input after extraction has produced definitions and unresolved references. */
export interface ResolveContext {
  /** Definitions available to resolver execution. */
  readonly definitions: readonly ProjectDefinition[]
  /** References emitted by extractors and not yet bound into index relations. */
  readonly references: readonly UnresolvedReference[]
}

/** Resolver output that can add relations, source refs, diagnostics, and dependency declarations. */
export interface ResolveResult {
  /** Relations produced after references are validated and bound. */
  readonly relations?: readonly ProjectRelation[]
  /** Supplemental source references discovered during resolution. */
  readonly sourceRefs?: readonly ExtractedSourceRef[]
  /** Diagnostics for references that could not be resolved safely. */
  readonly diagnostics?: readonly IndexDiagnostic[]
  /** Additional dependencies that should invalidate resolver/query output. */
  readonly dependencies?: readonly IndexDependency[]
}

/**
 * Reserved rule slot for checks that run after facts have been resolved into index definitions and
 * relations.
 *
 * Rules should be read-only analyses over index facts. They should return diagnostics/lint facts
 * rather than mutating definitions, relations, or source rows.
 */
export interface IndexRule<TOptions = unknown> {
  /** Manifest used for docs, config validation, availability policy, and diagnostics. */
  readonly manifest: IndexRuleManifest<TOptions>
  /** Stable message templates owned by the rule implementation. */
  readonly messages: Readonly<Record<string, string>>
  /** Runs a read-only check over resolved index facts. */
  check(ctx: IndexRuleContext): readonly IndexLintFinding[]
}

/** Read-only index view passed to rule checks after relation resolution. */
export interface IndexRuleContext {
  /** Resolved definitions visible to the rule. */
  readonly definitions: readonly ProjectDefinition[]
  /** Resolved relations visible to the rule. */
  readonly relations: readonly ProjectRelation[]
  /** Runtime configuration evidence from the active project config, when known. */
  readonly runtime?: {
    /** Whether a Crux Runtime Engine was configured for this index run. */
    readonly configured?: boolean
  }
  /** Optional type/program-aware read model supplied only when semantic analysis is available. */
  readonly semantic?: SemanticReadModel
}

/**
 * Reserved slot for compiler-owned snapshot, patch, source-row, or report emission.
 *
 * Emitters are not public in v1 because they affect the package's stable output contracts. Keeping the
 * slot in the manifest records the architecture without allowing arbitrary third-party index shapes.
 */
export interface IndexEmitter {
  /** Stable emitter name for future diagnostics and output configuration. */
  readonly name: string
}

/**
 * Reserved query declaration for future incremental/query-backed compiler execution.
 *
 * Query ids and versions are intended to participate in cache keys the same way extension identities
 * do today. V1 exposes the type as architecture scaffolding, not as a stable user-authored query API.
 */
export interface IndexQuery {
  /** Stable query id used as part of query cache identity. */
  readonly id: string
  /** Query version used to invalidate cached computations when behavior changes. */
  readonly version: string
}
