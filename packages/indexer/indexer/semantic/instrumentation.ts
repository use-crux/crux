import { performance } from 'node:perf_hooks'
import type { NativeSemanticCoverage } from './native/types'

export type SemanticIndexTimingName =
  | 'semantic.selection'
  | 'semantic.preflight'
  | 'semantic.cache.disabled'
  | 'semantic.cache.hit'
  | 'semantic.cache.miss'
  | 'semantic.cache.read'
  | 'semantic.cache.unkeyed'
  | 'semantic.program.create'
  | 'semantic.program.reuse'
  | 'semantic.checker.create'
  | 'semantic.analyzer.execution'
  | 'semantic.merge'
  | 'semantic.native.host.create'
  | 'semantic.native.host.reuse'
  | 'semantic.native.extractor.direct_crux'
  | 'semantic.native.analyzer.shared'
  | 'semantic.cache.write'

export interface SemanticIndexTiming {
  /** Name of the measured semantic indexing phase. */
  readonly name: SemanticIndexTimingName
  /** Wall-clock duration for the phase in milliseconds. */
  readonly durationMs: number
}

export interface SemanticIndexInstrumentation {
  /** Receives semantic phase timing events for benchmarks and worker logs. */
  readonly onTiming?: (timing: SemanticIndexTiming) => void
  /** Receives native engine coverage events for benchmarks and diagnostics. */
  readonly onNativeCoverage?: (coverage: NativeSemanticCoverage) => void
}

/** Measures a synchronous semantic indexing phase. */
export function measureSemanticTiming<T>(
  instrumentation: SemanticIndexInstrumentation | undefined,
  name: SemanticIndexTimingName,
  run: () => T,
): T {
  const started = performance.now()
  try {
    return run()
  } finally {
    emitSemanticTiming(instrumentation, { name, durationMs: performance.now() - started })
  }
}

/** Measures an asynchronous semantic indexing phase. */
export async function measureSemanticTimingAsync<T>(
  instrumentation: SemanticIndexInstrumentation | undefined,
  name: SemanticIndexTimingName,
  run: () => Promise<T>,
): Promise<T> {
  const started = performance.now()
  try {
    return await run()
  } finally {
    emitSemanticTiming(instrumentation, { name, durationMs: performance.now() - started })
  }
}

function emitSemanticTiming(
  instrumentation: SemanticIndexInstrumentation | undefined,
  timing: SemanticIndexTiming,
): void {
  try {
    instrumentation?.onTiming?.(timing)
  } catch {
    // Instrumentation is diagnostic-only and must not affect indexing results.
  }
}

/** Emits native semantic coverage without letting diagnostics affect indexing. */
export function emitNativeSemanticCoverage(
  instrumentation: SemanticIndexInstrumentation | undefined,
  coverage: NativeSemanticCoverage,
): void {
  try {
    instrumentation?.onNativeCoverage?.(coverage)
  } catch {
    // Instrumentation is diagnostic-only and must not affect indexing results.
  }
}
