import { resolve } from 'node:path'
import type { ProjectIndexSnapshot, ProjectModelResolutionMode } from '@use-crux/core/project-index'
import {
  astIndexPatchFromCompilerResult,
  compileProjectIndex,
  projectIndexSnapshotFromCompilerResult,
  runtimeIndexPatchFromCompilerResult,
} from './compiler'
import type { IndexPatch, IndexPatchBudget } from './patches'
import type { SemanticIndexInstrumentation } from './semantic/instrumentation'
import type { SemanticSourceProfile } from './semantic/source-profile'
import { createSemanticIndexService, type SemanticBackendSelection } from './semantic/service'
import type { StaticExtractionInstrumentation } from './static/extraction/engine'
import type { StaticParseCacheHit } from './static/extraction/types'
import {
  createProvidedStaticSyntaxFrontend,
  type NativeFactProjectionMode,
  type ProvidedStaticSyntaxRecordProvider,
  type StaticSyntaxFileRecord,
  type StaticSyntaxFrontendIdentity,
} from './static-index/syntax'

export interface IndexProjectOptions {
  /** Project root used for source discovery and config lookup. */
  readonly root: string
  /** Optional Crux config path, relative to `root` unless already absolute. */
  readonly configPath?: string
  /** Optional project name supplied by an embedding CLI or server. */
  readonly projectName?: string
  /** Controls how much evidence the Project Index compiler may gather. */
  readonly resolutionMode?: ProjectModelResolutionMode
  /** Budget for semantic enrichment patches. */
  readonly semanticBudget?: IndexPatchBudget
  /** Optional timing hook for semantic indexing benchmarks and worker diagnostics. */
  readonly semanticInstrumentation?: SemanticIndexInstrumentation
  /** Built-in semantic backend selection for this request. */
  readonly semanticBackend?: SemanticBackendSelection
  /** Existing snapshot used to select semantic files. */
  readonly previousIndex?: ProjectIndexSnapshot
  /** Internal AST/source handoff profile used to avoid duplicate semantic source scanning. */
  readonly semanticSourceProfile?: SemanticSourceProfile
}

interface IndexProjectAstOptions {
  readonly root: string
  readonly configPath?: string
  readonly projectName?: string
  /** Optional timing hook for AST/static indexing benchmarks and worker diagnostics. */
  readonly staticInstrumentation?: StaticExtractionInstrumentation
}

/** Options for projecting externally produced static syntax records. */
export interface IndexProjectAstFromSyntaxRecordsOptions extends IndexProjectAstOptions {
  /**
   * Complete static syntax records for the files selected by the compiler.
   *
   * The compiler still reads source text for hashing, source graph rows, cache
   * identity, and semantic handoff. Records are accepted only when their
   * `sourceHash` matches the current source text.
   */
  readonly records: readonly StaticSyntaxFileRecord[]
  /** Frontend identity to use when `records` is empty. */
  readonly frontendIdentity?: StaticSyntaxFrontendIdentity
}

/** Options for projecting externally produced records through a lazy provider. */
export interface IndexProjectAstFromSyntaxRecordProviderOptions extends IndexProjectAstOptions {
  /**
   * Lazy syntax record provider keyed by absolute source file path.
   *
   * Workers use this when records arrive as chunks or are spooled to disk, so
   * projection does not require retaining the complete record set in memory.
   */
  readonly recordProvider: ProvidedStaticSyntaxRecordProvider
  /** Frontend identity to use when the provider does not expose one directly. */
  readonly frontendIdentity?: StaticSyntaxFrontendIdentity
}

interface IndexProjectAstHostControls {
  /** Internal validated static cache hits supplied by a native parser host. */
  readonly staticCacheHits?: readonly StaticParseCacheHit[]
  /** Internal max size for provided syntax-record memoization. */
  readonly providedRecordCacheSize?: number
  /**
   * Internal native syntax-record fact lane to project.
   *
   * Defaults to `inline`, the existing combined native + TypeScript path.
   * Native hosts can request `external` or `native-only` for split-lane experiments without changing
   * public project config.
   */
  readonly nativeFactProjection?: NativeFactProjectionMode
}

/** Host-only options for projecting externally produced static syntax records. */
export interface IndexProjectAstFromSyntaxRecordsHostOptions
  extends IndexProjectAstFromSyntaxRecordsOptions,
    IndexProjectAstHostControls {}

/** Host-only options for projecting externally produced records through a lazy provider. */
export interface IndexProjectAstFromSyntaxRecordProviderHostOptions
  extends IndexProjectAstFromSyntaxRecordProviderOptions,
    IndexProjectAstHostControls {}

/** Options for explicit runtime-rich Project Index enrichment. */
export interface IndexProjectRuntimeOptions {
  /** Project root used for runtime-rich evidence collection. */
  readonly root: string
  /** Optional Crux config path, relative to `root` unless already absolute. */
  readonly configPath?: string
  /** Optional project name supplied by an embedding CLI or server. */
  readonly projectName?: string
  /**
   * Source/config/semantic snapshot to enrich.
   *
   * Runtime-rich indexing is modeled as an enrichment pass so callers cannot
   * accidentally execute authored modules while asking for the base index.
   */
  readonly previousIndex: ProjectIndexSnapshot
  /** Budget for runtime evidence patches. */
  readonly runtimeBudget?: IndexPatchBudget
}

/**
 * Builds a complete Project Index snapshot for a local project.
 *
 * This is the stable package entry point; lifecycle orchestration lives behind
 * the Project Index Compiler boundary so tests and workers can exercise the same path.
 */
export async function indexProject(options: IndexProjectOptions): Promise<ProjectIndexSnapshot> {
  const result = await compileProjectIndex({
    root: options.root,
    configPath: options.configPath,
    projectName: options.projectName,
    mode: options.resolutionMode,
  })
  return projectIndexSnapshotFromCompilerResult(result)
}

/**
 * Builds an AST/source-only index patch without importing user config modules.
 */
export async function indexProjectAst(options: IndexProjectAstOptions): Promise<IndexPatch> {
  const result = await compileProjectIndex({
    root: options.root,
    configPath: options.configPath,
    projectName: options.projectName,
    mode: 'source-only',
    staticInstrumentation: options.staticInstrumentation,
  })
  return astIndexPatchFromCompilerResult(result)
}

/**
 * Builds an AST/source-only index patch from caller-provided syntax records.
 *
 * This is the worker bridge used by Static Index indexing: Go can obtain
 * records from Rust/Oxc and Node can project them through the existing compiler
 * and trusted TypeScript extension runtime without reparsing source into a
 * TypeScript AST.
 */
export async function indexProjectAstFromSyntaxRecords(
  options: IndexProjectAstFromSyntaxRecordsOptions,
): Promise<IndexPatch> {
  return indexProjectAstFromSyntaxRecordsForHost(options)
}

/**
 * Projects caller-provided syntax records with host-only cache and native-projection controls.
 *
 * This is intentionally exported only from `@use-crux/indexer/host/static-index`; root callers get
 * `indexProjectAstFromSyntaxRecords(...)`, which omits worker-owned knobs from its public type.
 */
export async function indexProjectAstFromSyntaxRecordsForHost(
  options: IndexProjectAstFromSyntaxRecordsHostOptions,
): Promise<IndexPatch> {
  const result = await compileProjectIndex({
    root: options.root,
    configPath: options.configPath,
    projectName: options.projectName,
    mode: 'source-only',
    staticSyntaxFrontend: createProvidedStaticSyntaxFrontend({
      records: options.records,
      identity: options.frontendIdentity,
      instrumentation: options.staticInstrumentation,
      recordCacheSize: options.providedRecordCacheSize,
    }),
    staticInstrumentation: options.staticInstrumentation,
    staticCacheHits: options.staticCacheHits,
    nativeFactProjection: options.nativeFactProjection,
  })
  return astIndexPatchFromCompilerResult(result, { status: providedRecordPatchStatus(result.diagnostics) })
}

function providedRecordPatchStatus(diagnostics: readonly { readonly code: string }[]): IndexPatch['status'] | undefined {
  return diagnostics.some((diagnostic) => diagnostic.code === 'index.static_record_integrity') ? 'degraded' : undefined
}

/**
 * Builds an AST/source-only index patch from a lazy syntax record provider.
 *
 * This keeps the compiler-facing extraction path identical to
 * `indexProjectAstFromSyntaxRecords(...)`, but lets worker transports spool or
 * page records instead of materializing one project-wide array.
 */
export async function indexProjectAstFromSyntaxRecordProvider(
  options: IndexProjectAstFromSyntaxRecordProviderOptions,
): Promise<IndexPatch> {
  return indexProjectAstFromSyntaxRecordProviderForHost(options)
}

/**
 * Projects lazy syntax records with host-only cache and native-projection controls.
 *
 * Worker bundles use this host facade when records arrive as chunks, cache-hit metadata is already
 * validated, or the native fact lane is split for parity experiments.
 */
export async function indexProjectAstFromSyntaxRecordProviderForHost(
  options: IndexProjectAstFromSyntaxRecordProviderHostOptions,
): Promise<IndexPatch> {
  const result = await compileProjectIndex({
    root: options.root,
    configPath: options.configPath,
    projectName: options.projectName,
    mode: 'source-only',
    staticSyntaxFrontend: createProvidedStaticSyntaxFrontend({
      recordProvider: options.recordProvider,
      identity: options.frontendIdentity,
      instrumentation: options.staticInstrumentation,
      recordCacheSize: options.providedRecordCacheSize,
    }),
    staticInstrumentation: options.staticInstrumentation,
    staticCacheHits: options.staticCacheHits,
    nativeFactProjection: options.nativeFactProjection,
  })
  return astIndexPatchFromCompilerResult(result, { status: providedRecordPatchStatus(result.diagnostics) })
}

/**
 * Builds an explicit runtime-rich enrichment patch.
 *
 * This is the only package-level API that may import authored source modules.
 * Default source/config indexing stays execution-free for project files.
 */
export async function indexProjectRuntime(options: IndexProjectRuntimeOptions): Promise<IndexPatch> {
  const result = await compileProjectIndex({
    root: options.root,
    configPath: options.configPath,
    projectName: options.projectName,
    mode: 'runtime-rich',
  })
  return runtimeIndexPatchFromCompilerResult(result)
}

/**
 * Builds a semantic enrichment patch from compiler-resolved facts within the configured budget.
 */
export async function indexProjectSemantic(options: IndexProjectOptions): Promise<IndexPatch> {
  return createSemanticIndexService().indexProject({
    ...options,
    root: resolve(options.root),
    sourceProfile: options.semanticSourceProfile,
  })
}
