import type { IndexPatch } from './patches'
import type { StaticExtractionInstrumentation } from './static/extraction/engine'
import type { StaticParseCacheHit } from './static/extraction/types'
import {
  astIndexPatchFromCompilerResult,
  compileProjectIndex,
} from './compiler'
import {
  createProvidedStaticSyntaxFrontend,
  type NativeFactProjectionMode,
  type ProvidedStaticSyntaxRecordProvider,
  type StaticSyntaxFileRecord,
  type StaticSyntaxFrontendIdentity,
} from './static-index/syntax'

interface StaticRecordProjectionOptions {
  readonly root: string
  readonly configPath?: string
  readonly projectName?: string
  /** Optional timing hook for AST/static indexing benchmarks and worker diagnostics. */
  readonly staticInstrumentation?: StaticExtractionInstrumentation
}

/** Options for projecting externally produced static syntax records. */
export interface IndexProjectAstFromSyntaxRecordsOptions extends StaticRecordProjectionOptions {
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
export interface IndexProjectAstFromSyntaxRecordProviderOptions extends StaticRecordProjectionOptions {
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
   * Native hosts can request `external` or `native-only` for split-lane
   * experiments without changing public project config.
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

/**
 * Projects caller-provided syntax records with host-only cache and native-projection controls.
 *
 * Crux Local uses this host facade after the Rust Static Index frontend has
 * produced records. It does not parse bundled first-party facts in TypeScript.
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

/**
 * Projects lazy syntax records with host-only cache and native-projection controls.
 *
 * Worker bundles use this host facade when records arrive as chunks, cache-hit
 * metadata is already validated, or the native fact lane is split for parity
 * experiments.
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

function providedRecordPatchStatus(diagnostics: readonly { readonly code: string }[]): IndexPatch['status'] | undefined {
  return diagnostics.some((diagnostic) => diagnostic.code === 'index.static_record_integrity') ? 'degraded' : undefined
}
