import type {
  CatalogDiagnostic,
  CatalogLintFinding,
  JsonSchema,
  ProjectDefinition,
  ProjectDefinitionKind,
  ProjectRelation,
  ProjectSourceRef,
  ProjectSourceRefRole,
} from '@crux/core/catalog'
import type { StaticRelationRef } from '../types'

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

/**
 * Data-first manifest for contributing to the Project Catalog compiler.
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
export interface SourceIndexerExtension {
  /**
   * Stable extension identifier.
   *
   * Use a package-style name such as `@crux/core` or `@acme/catalog`. The registry sorts by this value,
   * diagnostics report it, and cache keys include it once extension loading becomes external.
   */
  readonly name: string
  /**
   * Version of the extension manifest and extractor behavior.
   *
   * Bump this when an extractor can produce different facts for the same source. The static cache uses
   * extension versions as invalidation input, so stale catalog facts are discarded when behavior changes.
   */
  readonly version: string
  /**
   * Extractors that convert matched source shapes into immutable catalog facts.
   *
   * This is the only slot production v1 static discovery currently executes. Extractors should be
   * source-local and side-effect free: read from `ExtractContext`, return `ExtractResult`, and let
   * resolver/rule/emitter stages handle linking and projection.
   */
  readonly extractors?: readonly CatalogExtractor[]
  /**
   * Reserved resolver contributions for binding unresolved references into catalog relations.
   *
   * Built-in resolver behavior handles first-party static relations today. This slot is present so the
   * manifest matches normal compiler architecture, but custom resolver authoring is not yet stable.
   */
  readonly resolvers?: readonly CatalogResolver[]
  /**
   * Reserved rule contributions for diagnostics or lint facts over resolved catalog facts.
   *
   * Rules should be pure analyses over their input catalog view. They should not mutate definitions,
   * relations, source rows, or snapshots.
   */
  readonly rules?: readonly CatalogRule[]
  /**
   * Reserved emitter contributions for compiler-owned output artifacts.
   *
   * Emitters affect stable outputs such as snapshots, patches, source rows, and reports. They are kept
   * internal in v1 so external extensions cannot fork the catalog contract.
   */
  readonly emitters?: readonly CatalogEmitter[]
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

/**
 * Source shape that can trigger an extractor.
 *
 * Patterns describe what the parser should consider, not what the extractor is allowed to mutate.
 * `importFrom` narrows matching to callees imported from specific module specifiers. When a callee is
 * imported under an alias, constrained patterns match the imported name rather than the local alias.
 * Unconstrained patterns still match the local call name.
 */
export type ExtractPattern =
  | {
      /** Matches a normal call expression such as `prompt({ ... })`. */
      readonly kind: 'call'
      /** Callee name considered by the static parser prefilter. */
      readonly name: string
      /** Optional module-specifier constraint for hardening call matching beyond bare callee names. */
      readonly importFrom?: readonly string[]
      /** Reserved index of the object/config argument when it is not the first argument. */
      readonly configArg?: number
    }
  | {
      /** Matches a constructor call such as `new Agent({ ... })`. */
      readonly kind: 'new'
      /** Constructor/class name considered by parser dispatch. */
      readonly name: string
      /** Optional module-specifier constraint for hardening constructor matching. */
      readonly importFrom?: readonly string[]
      /** Reserved index of the object/config argument when it is not the first argument. */
      readonly configArg?: number
    }

/**
 * Source-local fact extractor.
 *
 * A catalog extractor is analogous to a compiler transform pass over one matched source expression:
 * it receives a stable read/build context and returns facts. It should be deterministic for the same
 * context and should not reach into global compiler state.
 */
export interface CatalogExtractor {
  /** Stable extractor name used in diagnostics, ordering, and future cache keys. */
  readonly name: string
  /** Source patterns that make this extractor eligible for a parser-owned source match. */
  readonly patterns: readonly ExtractPattern[]
  /**
   * Converts a source-local match into immutable compiler facts.
   *
   * Extractors should be pure functions of `ctx`: read the stable readers, build definitions and
   * unresolved references, and return an `ExtractResult`. They must not write to the catalog graph,
   * append diagnostics to shared arrays, update caches, or read unrelated files. Cross-file linking
   * belongs in resolver/query stages so static extraction stays cacheable.
   */
  extract(ctx: ExtractContext): ExtractResult
}

/**
 * Stable read/build surface passed to one extractor invocation.
 *
 * The context deliberately exposes small views and builders rather than raw compiler internals.
 * `args`, `config`, `define`, `ref`, and `sourceRef` let first-party extractors describe catalog facts
 * without knowing how ids, source snippets, relation resolution, or catalog projection are implemented.
 *
 * `unstableNative` is a temporary compiler-owned escape hatch for first-party migrations. It is not a
 * third-party contract and may change without preserving TypeScript AST shapes.
 */
export interface ExtractContext {
  /**
   * Identity of the extension that owns the running extractor.
   *
   * Useful for diagnostics and future dependency declarations. It should be treated as read-only input,
   * not as a handle for registering more behavior during extraction.
   */
  readonly extension: ExtensionIdentity
  /**
   * Name of the running extractor inside its extension.
   *
   * This mirrors `CatalogExtractor.name` so diagnostics can point to a precise contribution even when
   * several extractors come from the same extension.
   */
  readonly extractor: string
  /**
   * Parser match that caused this extractor invocation.
   *
   * Use `ctx.match.name` when one extractor handles several factory names, for example eval extractors
   * that distinguish `evaluation`, `flowEvaluation`, and `ragEvaluation`.
   */
  readonly match: ExtractMatch
  /**
   * Source-local identity and file information for the current match.
   *
   * This is the stable replacement for reaching into TypeScript AST nodes for basic file/binding data.
   */
  readonly source: SourceView
  /**
   * Conservative reader for call or constructor arguments.
   *
   * Use this for positional APIs such as `suite('name', ...)`. Methods return literal/JSON-like values
   * or `undefined` when a value cannot be represented safely.
   */
  readonly args: StaticArgumentReader
  /**
   * Conservative reader for the selected object/config argument.
   *
   * `undefined` means the matched source did not have an object config argument. Extractors should
   * return `none()` or degrade gracefully instead of assuming an object is always present.
   */
  readonly config: StaticObjectReader | undefined
  /**
   * Definition builder bound to compiler-owned source and metadata defaults.
   *
   * Prefer `ctx.define.definition(...)` over constructing `ProjectDefinition` directly. It keeps
   * extractor code focused on catalog identity/metadata while the compiler supplies source ranges,
   * snippets, fidelity, and status.
   */
  readonly define: DefinitionBuilder
  /**
   * Builder for unresolved relation references.
   *
   * Use `ctx.ref.variable(...)` for authored identifiers that resolvers should bind after imports are
   * known. Use `ctx.ref.id(...)` only when the extractor already has a stable catalog id.
   */
  readonly ref: ReferenceBuilder
  /**
   * Builder for supplemental source references.
   *
   * Source refs are returned as facts and merged by the compiler. They should describe why a definition
   * exists or where important supporting source lives, such as schemas, callbacks, helper functions, or
   * template interpolations.
   */
  readonly sourceRef: SourceRefBuilder
  /**
   * Compiler-owned escape hatch for first-party migrations.
   *
   * Stable extractors should not rely on this field. It currently carries narrow TypeScript/static
   * parser views for first-party helpers that have not yet been replaced by stable source readers.
   */
  readonly unstableNative?: {
    /** Parser-owned static call context for internal helpers only. */
    readonly staticContext?: unknown
    /** Parser-owned TypeScript nodes for internal traversal helpers only. */
    readonly typescript?: unknown
  }
}

/**
 * Parser match that selected the extractor invocation.
 *
 * This is intentionally smaller than a TypeScript AST node. It tells extractors which manifest pattern
 * matched while keeping parser traversal and token/source ownership inside the compiler.
 */
export interface ExtractMatch {
  /** Pattern family that matched the source node. */
  readonly kind: ExtractPattern['kind']
  /** Matched call or constructor name. */
  readonly name: string
}

/**
 * Source-local identity information for the current extractor match.
 *
 * `variableName` is the authored binding when one exists. `localName` is a compiler fallback suitable
 * for local call-site discoveries that do not have a stable export name.
 */
export interface SourceView {
  /** Project root used for relative source ids and cache boundaries. */
  readonly root: string
  /** Absolute source file path being parsed. */
  readonly file: string
  /**
   * Authored binding name associated with the matched expression.
   *
   * For exported declarations this is the export-local variable. For local call-site discovery the
   * compiler supplies a deterministic fallback name.
   */
  readonly variableName: string
  /**
   * Human-readable fallback name for definitions discovered outside stable exports.
   *
   * Extractors can use this when config does not provide an explicit id/name and `variableName` is a
   * generated call-site fallback.
   */
  readonly localName: string
  /**
   * Sanitizes authored names for use inside catalog definition ids.
   *
   * The compiler owns id normalization so extractor output stays byte-for-byte compatible with the
   * parser's legacy ids and future parser profiles can apply the same rule without exposing their
   * native AST context. Use this for the variable segment of ids such as `prompt:${ctx.source.safeId(name)}`;
   * keep the catalog kind prefix explicit in the extractor so ids remain readable.
   */
  safeId(value: string): string
}

/**
 * Return value from an extractor.
 *
 * `facts` is the normal success path. `none` means the extractor recognized the syntactic shape but
 * found no catalog contribution. `degraded` is reserved for future partial extraction where the
 * compiler can keep safe facts while also surfacing diagnostics. All variants can declare additional
 * dependencies once query-backed execution grows beyond the current static cache keys.
 */
export type ExtractResult =
  | {
      readonly kind: 'none'
      readonly dependencies?: readonly IndexDependency[]
    }
  | {
      readonly kind: 'facts'
      readonly facts: ExtractedFacts
      readonly dependencies?: readonly IndexDependency[]
    }
  | {
      readonly kind: 'degraded'
      readonly facts?: ExtractedFacts
      readonly diagnostics: readonly CatalogDiagnostic[]
      readonly dependencies?: readonly IndexDependency[]
    }

/**
 * Immutable fact packet emitted by one extractor invocation.
 *
 * Facts are intentionally pre-resolution. They can contain definitions, unresolved edge requests,
 * supplemental source refs, and diagnostics, but they do not mutate the Project Catalog directly.
 */
export interface ExtractedFacts {
  /** Definitions and folded child definitions discovered from the matched source. */
  readonly definitions?: readonly ExtractedDefinition[]
  /** Source-local references that resolver slots later bind into catalog relations. */
  readonly references?: readonly UnresolvedReference[]
  /** Additional source locations attached to definitions without changing their primary source. */
  readonly sourceRefs?: readonly ExtractedSourceRef[]
  /** Diagnostics produced by partial/degraded extraction. */
  readonly diagnostics?: readonly CatalogDiagnostic[]
  /** Additional compiler inputs declared by the extractor result. */
  readonly dependencies?: readonly IndexDependency[]
}

/**
 * Definition contribution emitted by an extractor.
 *
 * `definition` must already use `@crux/core/catalog` kinds and metadata contracts. Extra definitions
 * are for folded children that belong to the same extracted unit, such as suite cases or routing
 * children, and remain tied to the primary variable for projection.
 */
export interface ExtractedDefinition {
  /** Source binding associated with this definition contribution. */
  readonly variableName: string
  /** Catalog definition using the stable `@crux/core/catalog` contract. */
  readonly definition: ProjectDefinition
  /**
   * Folded child definitions that should travel with the primary extracted definition.
   *
   * Use this for authored children discovered inside the same source expression, such as suite cases,
   * route children, or retrieval pipeline stages.
   */
  readonly extraDefinitions?: readonly ProjectDefinition[]
}

/**
 * Source-local edge request emitted by an extractor before resolver binding.
 *
 * A reference can point at a variable/import binding (`toVariable`) or a known catalog id (`toId`).
 * Keeping this unresolved lets extraction stay pure and file-local while resolver stages handle
 * cross-file imports, validation, and relation policy.
 */
export type UnresolvedReference = StaticRelationRef

/**
 * Source reference contribution targeted at a specific catalog definition id.
 *
 * These refs supplement a definition's primary source range. Common examples include callback handler
 * bodies, schema declarations, helper functions, or template interpolation sources that explain where a
 * catalog fact came from.
 */
export interface ExtractedSourceRef {
  /** Catalog definition id that should receive the supplemental source reference. */
  readonly definitionId: string
  /** Source reference value in the stable catalog format. */
  readonly ref: ProjectSourceRef
}

/**
 * Declares the semantics and validation envelope for a catalog relation type.
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
   * Where the relation should be visible in catalog consumers.
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
 * Reserved resolver slot for turning unresolved references into validated catalog relations.
 *
 * Production static indexing currently uses built-in resolver behavior. The type exists so relation
 * resolution can become an explicit extension phase without forcing extractors to change their return
 * shape.
 */
export interface CatalogResolver {
  /** Stable resolver name used in diagnostics and future query/cache keys. */
  readonly name: string
  /** Resolves references against extracted definitions and returns new immutable facts. */
  resolve(ctx: ResolveContext): ResolveResult
}

/** Resolver input after extraction has produced definitions and unresolved references. */
export interface ResolveContext {
  /** Definitions available to resolver execution. */
  readonly definitions: readonly ProjectDefinition[]
  /** References emitted by extractors and not yet bound into catalog relations. */
  readonly references: readonly UnresolvedReference[]
}

/** Resolver output that can add relations, source refs, diagnostics, and dependency declarations. */
export interface ResolveResult {
  /** Relations produced after references are validated and bound. */
  readonly relations?: readonly ProjectRelation[]
  /** Supplemental source references discovered during resolution. */
  readonly sourceRefs?: readonly ExtractedSourceRef[]
  /** Diagnostics for references that could not be resolved safely. */
  readonly diagnostics?: readonly CatalogDiagnostic[]
  /** Additional dependencies that should invalidate resolver/query output. */
  readonly dependencies?: readonly IndexDependency[]
}

/**
 * Reserved rule slot for checks that run after facts have been resolved into catalog definitions and
 * relations.
 *
 * Rules should be read-only analyses over catalog facts. They should return diagnostics/lint facts
 * rather than mutating definitions, relations, or source rows.
 */
export interface CatalogRule {
  /** Stable rule name used in diagnostics, docs, and future lint configuration. */
  readonly name: string
  /** Metadata used for docs, config validation, and stable diagnostic messages. */
  readonly meta: CatalogRuleMeta
  /** Runs a read-only check over resolved catalog facts. */
  check(ctx: CatalogRuleContext): readonly CatalogLintFinding[]
}

export interface CatalogRuleMeta {
  readonly docs: {
    readonly description: string
    readonly url?: string
  }
  readonly schema?: JsonSchema
  readonly messages: Readonly<Record<string, string>>
  readonly defaultOptions?: readonly unknown[]
}

/** Read-only catalog view passed to rule checks after relation resolution. */
export interface CatalogRuleContext {
  /** Resolved definitions visible to the rule. */
  readonly definitions: readonly ProjectDefinition[]
  /** Resolved relations visible to the rule. */
  readonly relations: readonly ProjectRelation[]
}

/**
 * Reserved slot for compiler-owned snapshot, patch, source-row, or report emission.
 *
 * Emitters are not public in v1 because they affect the package's stable output contracts. Keeping the
 * slot in the manifest records the architecture without allowing arbitrary third-party catalog shapes.
 */
export interface CatalogEmitter {
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

/**
 * Dependency that can invalidate cached extraction or query results.
 *
 * V1 static parsing derives most dependencies from source imports, config boundary files, and extension
 * identities. The explicit type is present so later semantic/query stages can declare additional
 * source or compiler inputs without changing extractor result shapes.
 */
export type IndexDependency =
  | { readonly kind: 'source-file'; readonly file: string }
  | { readonly kind: 'config-file'; readonly file: string }
  | { readonly kind: 'extension'; readonly name: string; readonly version: string }
  | { readonly kind: 'extractor'; readonly extension: string; readonly name: string }
  | { readonly kind: 'rule'; readonly extension: string; readonly name: string }

/**
 * Stable object-literal reader exposed to static extractors.
 *
 * Readers project TypeScript syntax into conservative literal data: strings, numbers, booleans,
 * identifiers, object readers, arrays, JSON-safe values, and schema projections. When a property cannot
 * be represented safely, methods return `undefined` or an empty array instead of exposing raw AST nodes.
 */
export interface StaticObjectReader {
  /** Returns whether a property exists in the object, including shorthand properties. */
  has(property: string): boolean
  /** Reads a string literal property or returns `undefined` for non-literal values. */
  string(property: string): string | undefined
  /** Reads a numeric literal property or returns `undefined` for non-literal values. */
  number(property: string): number | undefined
  /** Reads a boolean literal property or returns `undefined` for non-literal values. */
  boolean(property: string): boolean | undefined
  /** Reads a string-literal array property; unsupported or missing arrays return an empty array. */
  stringArray(property: string): readonly string[]
  /** Reads an identifier-valued property, preserving the authored binding name. */
  identifier(property: string): string | undefined
  /**
   * Reads a reference-like property, including shorthand properties and property-access expressions.
   *
   * Use this for config values that point at another authored binding or runtime component, for
   * example `{ store }` or `{ component: components.crux }`. The reader returns the authored binding
   * name or final property segment and returns `undefined` for dynamic expressions.
   */
  reference(property: string): string | undefined
  /** Reads an array of identifier references, preserving authored binding names. */
  identifierArray(property: string): readonly string[]
  /** Reads a nested object literal property as another stable object reader. */
  object(property: string): StaticObjectReader | undefined
  /** Reads an array of object literals as stable object readers. */
  objectArray(property: string): readonly StaticObjectReader[]
  /** Reads a factory call whose first argument is an object literal. */
  callObject(property: string): StaticCallObjectReader | undefined
  /** Reads an array of factory calls whose first argument is an object literal. */
  callObjectArray(property: string): readonly StaticCallObjectReader[]
  /** Reads a string literal through a nested object path such as `['write', 'mode']`. */
  nestedString(path: readonly string[]): string | undefined
  /** Reads object-map values that are identifier references, useful for tool maps and agent maps. */
  objectMapIdentifiers(property: string): readonly string[]
  /** Projects a property into JSON Schema when the static analyzer can do so safely. */
  schema(property: string): JsonSchema | undefined
  /**
   * Projects a property, or the whole object when omitted, into JSON-compatible data.
   *
   * Values that cannot be represented safely are omitted or returned as `undefined`.
   */
  json(property?: string): unknown
}

/**
 * Stable argument reader exposed to static extractors.
 *
 * Argument readers follow the same conservative model as config readers. They are best suited for
 * factory APIs such as `suite('name', ...)` or `defineThing('id', { ... })`, where source-local literal
 * values are enough to emit catalog facts.
 */
export interface StaticArgumentReader {
  /** Reads a string literal argument at `index`. */
  string(index: number): string | undefined
  /** Reads an identifier argument at `index`, preserving the authored binding name. */
  identifier(index: number): string | undefined
  /** Reads an object literal argument at `index` as a stable object reader. */
  object(index: number): StaticObjectReader | undefined
  /** Reads an array of object literals at `index` as stable object readers. */
  objectArray(index: number): readonly StaticObjectReader[]
  /** Projects an argument into JSON-compatible data when the value can be represented safely. */
  json(index: number): unknown
}

/**
 * Stable reader for a factory call with an object-literal config argument.
 *
 * This supports first-party APIs that accept arrays such as `blocks: [workingState({ ... })]`
 * without exposing TypeScript call nodes to extractors.
 */
export interface StaticCallObjectReader {
  /** Factory/callee name, for example `workingState` or `recentMessages`. */
  readonly name: string | undefined
  /** Reader for the call's first object/config argument. */
  readonly config: StaticObjectReader
}

/**
 * Author-facing alias for the positional argument reader.
 *
 * The older `StaticArgumentReader` name remains for internal compatibility during migration, but new
 * extractor code should prefer `ArgumentReader` because the public API is organized around compiler
 * roles rather than implementation modes.
 */
export type ArgumentReader = StaticArgumentReader

/**
 * Author-facing alias for the object/config reader.
 *
 * The older `StaticObjectReader` name remains for internal compatibility during migration, but new
 * extractor code should prefer `ConfigReader` to avoid exposing static-parser vocabulary at the API
 * boundary.
 */
export type ConfigReader = StaticObjectReader

/**
 * Author-facing alias for factory calls that carry object configs.
 *
 * Prefer this over native call nodes when an extractor needs to inspect arrays of configured helper
 * calls such as memory blocks or pipeline stages.
 */
export type ConfigCallReader = StaticCallObjectReader

/**
 * Builder for source references that point from catalog definitions back into authored code.
 *
 * Source refs are emitted as facts instead of attached through mutation. This keeps extraction
 * source-local and lets the compiler decide how refs are merged with primary definition locations.
 */
export interface SourceRefBuilder {
  /**
   * Returns a source ref for a named object/config property.
   *
   * Use this for simple literal or identifier-backed properties such as `{ system: SYSTEM_PROMPT }`.
   * Returns `undefined` when there is no config object or the property cannot be located safely.
   */
  property(input: {
    readonly property: string
    readonly role: ProjectSourceRefRole
    readonly definitionId: string
    readonly metadata?: Readonly<Record<string, unknown>>
  }): ExtractedSourceRef | undefined
  /**
   * Returns a source ref for a callback/function-valued config property.
   *
   * Use this for handler-style properties such as `execute`, `resolve`, `usageHandler`, or `check`.
   * Returns `undefined` when the callback is absent or cannot be represented safely.
   */
  callbackProperty(input: {
    readonly property: string
    readonly role: ProjectSourceRefRole
    readonly definitionId: string
    readonly metadata?: Readonly<Record<string, unknown>>
  }): ExtractedSourceRef | undefined
  /**
   * Returns source refs for expressions interpolated into a template-literal property.
   *
   * This lets detail views point from a static prompt/context definition back to supporting constants
   * used inside template strings.
   */
  templateInterpolations(input: {
    readonly property: string
    readonly role: ProjectSourceRefRole
    readonly definitionId: string
  }): readonly ExtractedSourceRef[]
  /**
   * Projects a schema property and returns both the schema and source refs for schema declarations.
   *
   * Use the returned `schema` for definition metadata and spread `sourceRefs` into extracted facts so
   * consumers can navigate to nested or helper schema definitions.
   */
  schemaProperty(input: { readonly property: string; readonly definitionId: string }): {
    readonly schema?: JsonSchema
    readonly sourceRefs: readonly ExtractedSourceRef[]
  }
  /**
   * Returns source refs for helper functions referenced by a config property.
   *
   * `maxDepth` limits conservative traversal through helper bodies. The helper is intended for
   * first-party static intelligence such as visible data access, not arbitrary public AST traversal.
   */
  helperRefsForProperty(input: {
    readonly property: string
    readonly definitionId: string
    readonly maxDepth?: number
  }): readonly ExtractedSourceRef[]
}

/**
 * Builder for catalog definitions that applies compiler-owned source, id, and metadata defaults.
 *
 * Extractors should prefer this builder over constructing `ProjectDefinition` objects manually unless
 * they are reusing an existing compiler-owned definition. The builder keeps definition construction
 * pure while centralizing details such as source snippets and fidelity/status defaults.
 */
export interface DefinitionBuilder {
  /**
   * Builds a catalog definition contribution using compiler-owned source defaults.
   *
   * The returned value is an `ExtractedDefinition`, ready to place in `facts({ definitions: [...] })`.
   */
  definition(input: DefinitionBuilderInput): ExtractedDefinition
  /**
   * Wraps an already-built compiler-owned definition contribution.
   *
   * Use this when another compiler helper has already constructed a `ProjectDefinition` with the
   * correct source and metadata defaults.
   */
  fromProjectDefinition(input: ExtractedDefinition): ExtractedDefinition
}

/**
 * Input accepted by `DefinitionBuilder.definition`.
 *
 * The builder receives catalog identity and metadata only; source ranges, snippets, default fidelity,
 * and status are supplied by the compiler context. This division keeps extractor output deterministic
 * and avoids repeated source-normalization code in each first-party extractor.
 */
export interface DefinitionBuilderInput {
  /** Source binding associated with the definition contribution. */
  readonly variableName: string
  /** Stable catalog definition id. */
  readonly id: string
  /** Stable catalog definition kind from `@crux/core/catalog`. */
  readonly kind: ProjectDefinitionKind
  /** Display name for catalog consumers. */
  readonly name: string
  /** JSON-like metadata to attach to the catalog definition. */
  readonly metadata?: Readonly<Record<string, unknown>>
}

/**
 * Builder for unresolved relation references.
 *
 * Use `variable(...)` when the target should be resolved against imports or local bindings. Use
 * `id(...)` only when the extractor already knows a stable catalog definition id.
 */
export interface ReferenceBuilder {
  /**
   * Creates a reference to an authored variable/import binding.
   *
   * The resolver binds this later, after file-local and imported definitions are known.
   */
  variable(type: string, toVariable: string): UnresolvedReference
  /**
   * Creates a reference to a known catalog definition id.
   *
   * Prefer `variable(...)` when the target came from source code as an identifier; use `id(...)` when
   * the extractor has intentionally constructed or read a stable catalog id.
   */
  id(type: string, toId: string): UnresolvedReference
}
