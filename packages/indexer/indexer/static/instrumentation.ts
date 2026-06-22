/**
 * Instrumentation hooks for the syntax-only Project Index pipeline.
 *
 * These hooks report compiler-owned phase timings. They intentionally expose
 * stable phase names and durations, not parser-native ASTs or checker objects,
 * so TypeScript, Rust/Oxc, and future frontends can be compared through the
 * same contract.
 *
 * @module
 */

/** Stable timing buckets emitted by static extraction. */
export type StaticExtractionTimingName =
  | 'static.extract_file.total'
  | 'static.semantic_profile'
  | 'static.cache.key'
  | 'static.cache.read'
  | 'static.cache.write'
  | 'static.syntax_records.total'
  | 'static.syntax_record.batch_parse'
  | 'static.syntax_record.parse_file'
  | 'static.syntax_record.provider_read'
  | 'static.syntax_record.provider_json_parse'
  | 'static.syntax_record.preload_imports'
  | 'static.syntax_record.extract_matches'
  | 'static.syntax_record.tree_paths'
  | 'static.syntax_record.imported_definitions'

/** One measured static extraction phase. */
export interface StaticExtractionTiming {
  /** Stable bucket name for aggregation and benchmark output. */
  readonly name: StaticExtractionTimingName
  /** Source file associated with this phase, when the phase is file-scoped. */
  readonly file?: string
  /** Wall-clock duration in milliseconds. Concurrent file phases may overlap. */
  readonly durationMs: number
}

/**
 * Optional observation hooks for static extraction.
 *
 * Callbacks are synchronous and run on the extraction path. They should perform
 * cheap aggregation only; heavy reporting should be buffered by the caller.
 */
export interface StaticExtractionInstrumentation {
  /** Called after each measured static extraction phase completes. */
  readonly onTiming?: (timing: StaticExtractionTiming) => void
}

/** Measures a static extraction phase and reports it to the provided hooks. */
export async function withStaticExtractionTiming<T>(
  instrumentation: StaticExtractionInstrumentation | undefined,
  name: StaticExtractionTimingName,
  file: string | undefined,
  run: () => T | Promise<T>,
): Promise<T> {
  const startedAt = nowMs()
  try {
    return await run()
  } finally {
    instrumentation?.onTiming?.({
      name,
      file,
      durationMs: Math.max(0, nowMs() - startedAt),
    })
  }
}

function nowMs(): number {
  return globalThis.performance?.now() ?? Date.now()
}
