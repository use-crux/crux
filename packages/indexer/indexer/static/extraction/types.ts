import type { IndexDiagnostic, IndexRuleDescriptor, ProjectDefinition, ProjectRelation } from '@use-crux/core/project-index'
import type { ExtensionRuleInput, ExtensionRuleResult, IndexDependency, IndexerExtension } from '../../extensions'
import type { ExtensionRuntimeManifest } from '../../extensions/runtime/engine'
import type { ProjectIndexCompilerProfile } from '../../compiler/profile'
import type { SemanticSourceProfileFile } from '../../semantic/source-profile'
import type { StaticExtractionInstrumentation } from '../instrumentation'
import type { NativeFactProjectionMode, StaticSyntaxFrontend, StaticSyntaxFrontendFactory } from '../../static-index/syntax/record'
import type { StaticExtractionIdentity } from './identity'
import type { SourceReader } from './source-io'

/**
 * Configuration for a static extraction run.
 *
 * Static extraction is the source-syntax Project Index pass. It is designed for the common compiler
 * path first: provide a project root, optionally add trusted extension manifests, and extract files
 * into immutable definitions, relations, diagnostics, and source dependencies.
 *
 * The `sources` and `cache` options are local substitution points. They let tests and tools use the
 * same extraction engine as production while replacing filesystem reads or persistent caching.
 */
export interface StaticExtractionOptions {
  /** Absolute project root used to normalize source paths, dependencies, config files, and cache keys. */
  readonly root: string
  /** Compiler profile for first-party extractors and compiler-owned projections. Defaults to Crux core. */
  readonly profile?: ProjectIndexCompilerProfile
  /** Trusted extension manifests appended to the compiler profile for this engine instance. */
  readonly extensions?: readonly IndexerExtension[]
  /** Internal compiler inputs that affect static output but are resolved outside extension manifests. */
  readonly additionalCacheInputs?: readonly IndexDependency[]
  /** Source text provider. Defaults to filesystem reads; fixture tests usually pass an in-memory reader. */
  readonly sources?: SourceReader
  /**
   * Syntax-record frontend or frontend factory used by this engine.
   *
   * This is an internal compiler substitution point, not a public project config flag. Omit it to
   * use the TypeScript-backed record frontend. Prefer passing a factory for native frontends so the
   * engine can inject the compiler runtime's extractor call names before parsing.
   */
  readonly syntaxFrontend?: StaticSyntaxFrontend | StaticSyntaxFrontendFactory
  /**
   * Native syntax-record fact lane to emit.
   *
   * `inline` keeps the combined historical output. Native hosts can request
   * `external` to run only the TypeScript extractor lane while still honoring
   * native replacement metadata, or `native-only` to emit only native packets.
   *
   * @internal
   */
  readonly nativeFactProjection?: NativeFactProjectionMode
  /** Cache behavior for per-file extraction. Defaults to the project-local persistent cache. */
  readonly cache?: 'persistent' | 'none' | StaticParseCacheStore
  /**
   * Optional low-overhead instrumentation hooks.
   *
   * Timings use stable compiler phase names so TypeScript and native frontends can be benchmarked
   * without exposing AST or checker internals.
   */
  readonly instrumentation?: StaticExtractionInstrumentation
  /**
   * Internal validated cache hits supplied by a native parser host.
   *
   * These let warm native runs avoid recomputing exact static cache keys for
   * files whose manifest entry was already validated during planning.
   */
  readonly cacheHits?: readonly StaticParseCacheHit[]
}

/**
 * Extracts syntax-level Project Index facts from source files.
 *
 * `StaticExtractionEngine` is the single boundary for the syntax/static phase. It owns frontend
 * construction, extension ordering, cache identity, syntax frontend identity, source reads,
 * per-file parse memoization, and extension rule execution. Callers should treat the engine as a
 * pure compiler service: source text in, immutable facts out.
 *
 * Engine instances are reusable across files in one compiler run. They do not retain parsed source
 * files between `extractFile(...)` calls, which keeps configuration and extension changes from
 * leaking stale syntax trees into later runs.
 *
 * @example
 * ```ts
 * const extraction = createStaticExtraction({ root: process.cwd() })
 * const file = await extraction.extractFile('/repo/src/prompts.ts')
 * const ruleResult = extraction.rules.check({
 *   definitions: file.definitions,
 *   relations: file.relations,
 * })
 * ```
 */
export interface StaticExtractionEngine {
  /**
   * Structural identity for this engine.
   *
   * These inputs are the only compiler-owned values allowed to participate in static cache keys.
   * They include extension/extractor/rule identities, compiler profile/projection identities, and
   * the selected syntax frontend version.
   */
  readonly identity: StaticExtractionIdentity
  /** Normalized extension manifest after deterministic sorting and validation. */
  readonly manifest: ExtensionRuntimeManifest
  /**
   * Extracts one source file.
   *
   * The result is safe to serialize. It contains no TypeScript AST nodes and no mutable compiler
   * state. When caching is enabled, a matching cached value is returned with `fromCache: true`.
   */
  extractFile(file: string): Promise<StaticFileExtraction>
  /**
   * Extracts many source files with bounded concurrency.
   *
   * Output order matches input order, regardless of completion order. Use this for batch compiler
   * work where individual files can be parsed independently.
   */
  extractFiles(
    files: readonly string[],
    options?: { readonly concurrency?: number },
  ): Promise<readonly StaticFileExtraction[]>
  /**
   * Project-level rule phase.
   *
   * Rules run after callers merge file-level definitions and relations. Static extraction does not
   * run rules per file because rule semantics are project-level, similar to an ESLint pass over the
   * completed fact set.
   */
  readonly rules: {
    /** User-facing metadata for extension-provided rules. */
    readonly descriptors: readonly IndexRuleDescriptor[]
    /** Checks a merged project fact set and returns findings plus diagnostics. */
    check(input: ExtensionRuleInput): ExtensionRuleResult
  }
  /**
   * Explains a file extraction.
   *
   * This returns the same facts as `extractFile(...)` plus the structural cache inputs used by the
   * engine. It is intended for tests, diagnostics, and debugging cache invalidation behavior.
   */
  explainFile(file: string): Promise<StaticExtractionExplanation>
}

/**
 * Syntax-only Project Index facts for one source file.
 *
 * Definitions and relations are already in the Project Index shape. Later compiler phases may enrich
 * them with semantic information, runtime joins, or final source graph presentation, but static
 * extraction owns the facts it can prove from source text alone.
 */
export interface StaticFileExtraction {
  /** Absolute source file path that produced this result. */
  readonly file: string
  /** Definitions proven from syntax, extension extractors, and compiler-owned projections. */
  readonly definitions: readonly ProjectDefinition[]
  /** Relations proven or resolved from static references in this extraction pass. */
  readonly relations: readonly ProjectRelation[]
  /** Diagnostics that should be surfaced with the static Project Index output. */
  readonly diagnostics: readonly IndexDiagnostic[]
  /** Direct source files whose text can change this file's static output. */
  readonly dependencies: readonly string[]
  /** Internal semantic source profile row produced while source text was already available. */
  readonly semanticProfile?: SemanticSourceProfileFile
  /** `true` when the result came from the engine cache instead of parsing source text. */
  readonly fromCache: boolean
}

/** Source hash row stored inside a static parse cache manifest entry. */
export interface StaticParseCacheSourceHash {
  /** Path relative to the project root using POSIX separators. */
  readonly file: string
  /** SHA-256 hash of that file's UTF-8 source. */
  readonly sourceHash: string
}

/**
 * Exact cache-key metadata for one static parse result.
 *
 * Persistent stores may use this to maintain a cheap per-file manifest. The
 * manifest lets native parser hosts skip Rust/Oxc work on warm runs without
 * recomputing dependency keys through a TypeScript parse in the planning step.
 */
export interface StaticParseCacheEntryMetadata {
  readonly version: string
  readonly root: string
  readonly file: string
  readonly sourceHash: string
  readonly dependencies: readonly StaticParseCacheSourceHash[]
  readonly configFiles: readonly StaticParseCacheSourceHash[]
  readonly compilerInputs: readonly unknown[]
}

/** Validated static parse cache hit supplied by a native parser host. */
export interface StaticParseCacheHit {
  /** Absolute source file path. */
  readonly file: string
  /** Opaque cache key string previously validated by the planner. */
  readonly cacheKey: string
}

/**
 * Storage adapter for static extraction results.
 *
 * Stores receive opaque keys and complete extraction values. They do not construct cache identity;
 * the engine owns that so every cache lookup includes the same source hashes, config hashes,
 * compiler inputs, and syntax frontend identity.
 */
export interface StaticParseCacheStore {
  /** Returns a cached extraction result for an opaque key, if one exists. */
  get(key: string): Promise<StaticFileExtraction | undefined>
  /** Persists an extraction result for an opaque key. Implementations should be best-effort. */
  set(key: string, value: StaticFileExtraction, metadata?: StaticParseCacheEntryMetadata): Promise<void>
}

/**
 * Extraction output with identity details attached.
 *
 * Use this when debugging cache invalidation or writing tests that assert which structural inputs
 * are part of a run. It intentionally exposes inputs, not the full cache key shape.
 */
export interface StaticExtractionExplanation extends StaticFileExtraction {
  readonly cacheInputs: readonly IndexDependency[]
}
