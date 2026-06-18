import { performance } from 'node:perf_hooks'

export type SemanticIndexTimingName =
  | 'semantic.selection'
  | 'semantic.preflight'
  | 'semantic.cache.read'
  | 'semantic.program.create'
  | 'semantic.checker.create'
  | 'semantic.analyzer.execution'
  | 'semantic.merge'
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
