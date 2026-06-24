import type { IndexDiagnostic, ProjectDefinition, ProjectSourceRef } from '@crux/core/project-index'
import type { StaticRelationRef } from '../../types'
import type {
  DefinitionBuilder,
  ReferenceBuilder,
  SourceRefBuilder,
  StaticArgumentReader,
  StaticObjectReader,
} from './authoring-types'
import type { IndexDependency } from './cache-dependency-types'
import type { NativeSyntaxHandle } from '../static-record-adapter/native-context'
import type { ExtensionIdentity } from './manifest-types'

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
  | {
      /** Matches an object literal expression, usually for first-party compatibility object schemas. */
      readonly kind: 'object'
    }

/**
 * Source-local fact extractor.
 *
 * A index extractor is analogous to a compiler transform pass over one matched source expression:
 * it receives a stable read/build context and returns facts. It should be deterministic for the same
 * context and should not reach into global compiler state.
 */
export interface IndexExtractor {
  /** Stable extractor name used in diagnostics, ordering, and future cache keys. */
  readonly name: string
  /** Source patterns that make this extractor eligible for a parser-owned source match. */
  readonly patterns: readonly ExtractPattern[]
  /**
   * Converts a source-local match into immutable compiler facts.
   *
   * Extractors should be pure functions of `ctx`: read the stable readers, build definitions and
   * unresolved references, and return an `ExtractResult`. They must not write to the index graph,
   * append diagnostics to shared arrays, update caches, or read unrelated files. Cross-file linking
   * belongs in resolver/query stages so static extraction stays cacheable.
   */
  extract(ctx: ExtractContext): ExtractResult
}

/**
 * Stable read/build surface passed to one extractor invocation.
 *
 * The context deliberately exposes small views and builders rather than raw compiler internals.
 * `args`, `config`, `define`, `ref`, and `sourceRef` let first-party extractors describe index facts
 * without knowing how ids, source snippets, relation resolution, or index projection are implemented.
 *
 * `internalNative` is a branded compiler-owned payload for first-party adapters only. It is not part
 * of the public extension contract and may change or disappear once migration helpers stop needing
 * native TypeScript nodes.
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
   * This mirrors `IndexExtractor.name` so diagnostics can point to a precise contribution even when
   * several extractors come from the same extension.
   */
  readonly extractor: string
  /**
   * Parser match that caused this extractor invocation.
   *
   * Use `ctx.match.name` when one extractor handles several factory names, for example routing
   * extractors that distinguish `router`, `cascade`, and `fallback`.
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
   * extractor code focused on index identity/metadata while the compiler supplies source ranges,
   * snippets, fidelity, and status.
   */
  readonly define: DefinitionBuilder
  /**
   * Builder for unresolved relation references.
   *
   * Use `ctx.ref.variable(...)` for authored identifiers that resolvers should bind after imports are
   * known. Use `ctx.ref.id(...)` only when the extractor already has a stable index id.
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
   * Compiler-owned payload for first-party adapters.
   *
   * Public extension authors do not receive this field. It carries an opaque handle instead of raw
   * structurally typed AST objects so native syntax access remains centralized in compiler helpers.
   */
  readonly internalNative?: NativeSyntaxHandle
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
   * Sanitizes authored names for use inside index definition ids.
   *
   * The compiler owns id normalization so extractor output stays byte-for-byte compatible with the
   * parser's legacy ids and future parser profiles can apply the same rule without exposing their
   * native AST context. Use this for the variable segment of ids such as `prompt:${ctx.source.safeId(name)}`;
   * keep the index kind prefix explicit in the extractor so ids remain readable.
   */
  safeId(value: string): string
}

/**
 * Return value from an extractor.
 *
 * `facts` is the normal success path. `none` means the extractor recognized the syntactic shape but
 * found no index contribution. `degraded` is reserved for future partial extraction where the
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
      readonly diagnostics: readonly IndexDiagnostic[]
      readonly dependencies?: readonly IndexDependency[]
    }

/**
 * Immutable fact packet emitted by one extractor invocation.
 *
 * Facts are intentionally pre-resolution. They can contain definitions, unresolved edge requests,
 * supplemental source refs, and diagnostics, but they do not mutate the Project Index directly.
 */
export interface ExtractedFacts {
  /** Definitions and folded child definitions discovered from the matched source. */
  readonly definitions?: readonly ExtractedDefinition[]
  /** Source-local references that resolver slots later bind into index relations. */
  readonly references?: readonly UnresolvedReference[]
  /** Additional source locations attached to definitions without changing their primary source. */
  readonly sourceRefs?: readonly ExtractedSourceRef[]
  /** Diagnostics produced by partial/degraded extraction. */
  readonly diagnostics?: readonly IndexDiagnostic[]
  /** Additional compiler inputs declared by the extractor result. */
  readonly dependencies?: readonly IndexDependency[]
}

/**
 * Definition contribution emitted by an extractor.
 *
 * `definition` must already use `@crux/core/project-index` kinds and metadata contracts. Extra definitions
 * are for folded children that belong to the same extracted unit, such as suite cases or routing
 * children, and remain tied to the primary variable for projection.
 */
export interface ExtractedDefinition {
  /** Source binding associated with this definition contribution. */
  readonly variableName: string
  /** Index definition using the stable `@crux/core/project-index` contract. */
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
 * A reference can point at a variable/import binding (`toVariable`) or a known index id (`toId`).
 * Keeping this unresolved lets extraction stay pure and file-local while resolver stages handle
 * cross-file imports, validation, and relation policy.
 */
export type UnresolvedReference = StaticRelationRef

/**
 * Source reference contribution targeted at a specific index definition id.
 *
 * These refs supplement a definition's primary source range. Common examples include callback handler
 * bodies, schema declarations, helper functions, or template interpolation sources that explain where a
 * index fact came from.
 */
export interface ExtractedSourceRef {
  /** Index definition id that should receive the supplemental source reference. */
  readonly definitionId: string
  /** Source reference value in the stable index format. */
  readonly ref: ProjectSourceRef
}

export type { IndexDependency } from './cache-dependency-types'
