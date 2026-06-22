import type { StaticExtractionTimingName } from '@crux/indexer'

/** Static extraction phase order used by benchmark output. */
export const STATIC_TIMING_ORDER = [
  'static.extract_file.total',
  'static.semantic_profile',
  'static.cache.key',
  'static.cache.read',
  'static.syntax_records.total',
  'static.syntax_record.batch_parse',
  'static.syntax_record.parse_file',
  'static.syntax_record.preload_imports',
  'static.syntax_record.extract_matches',
  'static.syntax_record.tree_paths',
  'static.syntax_record.imported_definitions',
  'static.cache.write',
] satisfies readonly StaticExtractionTimingName[]

/** Semantic phase order used by benchmark output. */
export const SEMANTIC_TIMING_ORDER = [
  'semantic.selection',
  'semantic.preflight',
  'semantic.cache.read',
  'semantic.program.create',
  'semantic.program.reuse',
  'semantic.checker.create',
  'semantic.analyzer.execution',
  'semantic.merge',
  'semantic.native.host.create',
  'semantic.native.host.reuse',
  'semantic.native.extractor.direct_crux',
  'semantic.native.analyzer.shared',
  'semantic.cache.write',
  'semantic.patch.serialization',
] as const

/** Prints aggregated timing totals in a stable order. */
export function printTimingSummary(
  prefix: string,
  timings: readonly { readonly name: string; readonly durationMs: number }[],
  order: readonly string[],
): void {
  for (const name of order) {
    const durationMs = timings
      .filter((timing) => timing.name === name)
      .reduce((sum, timing) => sum + timing.durationMs, 0)
    console.log(`  ${prefix}.${name}=${durationMs > 0 ? `${durationMs.toFixed(1)}ms` : 'n/a'}`)
  }
}
