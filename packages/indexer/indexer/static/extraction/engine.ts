import type { IndexDiagnostic, IndexRuleDescriptor, ProjectDefinition, ProjectRelation } from '@crux/core/project-index'
import type { IndexerExtension, IndexDependency, ExtensionRuleInput, ExtensionRuleResult } from '../../extensions'
import type { ExtensionRuntimeManifest } from '../../extensions/runtime'
import {
  createProjectIndexCompilerRuntime,
  cruxCoreCompilerProfile,
  type ProjectIndexCompilerProfile,
} from '../../compiler/profile'
import { mapBounded } from '../../pipeline'
import { parseStaticDefinitionsFromFacts } from '../file'
import { cacheKeyInput, noStaticParseCache, persistentStaticParseCache } from './cache'
import { staticExtractionIdentity, type StaticExtractionIdentity } from './identity'
import { createStaticExtractionParser } from './parser'
import { createParseMemo, nodeSourceReader, type ParseMemo, type SourceReader } from './source-io'

export type { SourceReader } from './source-io'

/**
 * Configuration for a static extraction run.
 *
 * Static extraction is the syntax-only Project Index pass. It is designed for the common compiler
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
  /** Source text provider. Defaults to filesystem reads; fixture tests usually pass an in-memory reader. */
  readonly sources?: SourceReader
  /** Cache behavior for per-file extraction. Defaults to the project-local persistent cache. */
  readonly cache?: 'persistent' | 'none' | StaticParseCacheStore
}

/**
 * Extracts syntax-level Project Index facts from source files.
 *
 * `StaticExtractionEngine` is the single boundary for the AST/static phase. It owns parser
 * construction, extension ordering, cache identity, TypeScript frontend identity, source reads,
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
   * the TypeScript frontend version.
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
  /** `true` when the result came from the engine cache instead of parsing source text. */
  readonly fromCache: boolean
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
  set(key: string, value: StaticFileExtraction): Promise<void>
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

/**
 * Creates the static extraction engine for a project root.
 *
 * The returned object is frozen and has no registration side effects. Extension manifests are
 * normalized at construction time; invalid manifests fail fast before any source file is read.
 */
export function createStaticExtraction(options: StaticExtractionOptions): StaticExtractionEngine {
  const profile = compilerProfileWithExtensions(options.profile ?? cruxCoreCompilerProfile, options.extensions ?? [])
  const runtime = createProjectIndexCompilerRuntime(profile)
  const identity = staticExtractionIdentity({ profile, extensionRuntime: runtime.extensionRuntime })
  const parser = createStaticExtractionParser(runtime.extensionRuntime, {
    intrinsicCallNames: [...identity.callNames],
  })
  const sources = options.sources ?? nodeSourceReader()
  const cacheEnabled = options.cache !== 'none'
  const cache = cacheStore(options.root, options.cache)

  const extractFile = async (file: string): Promise<StaticFileExtraction> => {
    const parseMemo = createParseMemo(sources)
    const key = cacheEnabled
      ? await cacheKeyInput({
          root: options.root,
          file,
          parseMemo,
          compilerInputs: identity.cacheInputs,
        })
      : undefined
    if (key) {
      const cached = await cache.get(JSON.stringify(key))
      if (cached) return cached
    }
    const parsed = await parseWithMemo(options.root, file, parser, parseMemo)
    const extracted = Object.freeze({ file, ...parsed, fromCache: false })
    if (key) await cache.set(JSON.stringify(key), extracted)
    return extracted
  }

  return Object.freeze({
    identity,
    manifest: runtime.extensionRuntime.manifest,
    extractFile,
    extractFiles: (files: readonly string[], extractOptions?: { readonly concurrency?: number }) =>
      mapBounded(files, extractOptions?.concurrency ?? 8, (file) => extractFile(file)),
    rules: Object.freeze({
      descriptors: runtime.extensionRuntime.ruleDescriptors,
      check: runtime.extensionRuntime.checkRules,
    }),
    explainFile: async (file: string) => ({
      ...(await extractFile(file)),
      cacheInputs: identity.cacheInputs,
    }),
  })
}

async function parseWithMemo(
  root: string,
  file: string,
  parser: Parameters<typeof parseStaticDefinitionsFromFacts>[2],
  parseMemo: ParseMemo,
): Promise<Omit<StaticFileExtraction, 'file' | 'fromCache'>> {
  return parseStaticDefinitionsFromFacts(root, file, parser, parseMemo)
}

/**
 * Appends caller-provided extensions to a compiler profile without mutating the base profile.
 *
 * Profiles are treated as value inputs for cache identity, so the engine always creates a fresh
 * profile object when the configured extension set changes.
 */
function compilerProfileWithExtensions(
  profile: ProjectIndexCompilerProfile,
  extensions: readonly IndexerExtension[],
): ProjectIndexCompilerProfile {
  if (extensions.length === 0) return profile
  return {
    ...profile,
    extensions: [...profile.extensions, ...extensions],
  }
}

/**
 * Resolves the cache option into a store implementation for this engine instance.
 *
 * The engine still decides whether a lookup should occur. The store only answers reads and writes for
 * keys that already include source hashes, profile identity, extension identity, and syntax frontend
 * identity.
 */
function cacheStore(root: string, cache: StaticExtractionOptions['cache']): StaticParseCacheStore {
  if (cache === 'none') return noStaticParseCache()
  if (!cache || cache === 'persistent') return persistentStaticParseCache(root)
  return cache
}
