/**
 * Devtools observability bridge for the standalone Quality runner.
 *
 * The runner loads the project's own `@crux/core` instance to avoid the
 * dual-package hazard. These helpers therefore accept the small structural
 * subset of that internal runner module needed to install and flush the
 * canonical HTTP observability transport.
 */

export interface QualityRunnerObservabilityCore<TTransport> {
  currentObservabilityTransport(): TTransport | undefined
  createHttpObservabilityTransport(options: { readonly serverUrl?: string }): TTransport
  setObservabilityTransport(transport: TTransport | undefined): () => void
}

export interface QualityRunnerFlushCore {
  observe: {
    flush(options?: { readonly timeoutMs?: number }): Promise<boolean>
  }
}

/**
 * Install devtools graph ingestion for quality runs when the Go CLI has found
 * a local devtools server. Existing project observability config wins.
 */
export function enableQualityRunnerObservability<TTransport>(
  core: QualityRunnerObservabilityCore<TTransport>,
  serverUrl: string | undefined,
): (() => void) | undefined {
  if (serverUrl === undefined || serverUrl.trim() === '') return undefined
  if (core.currentObservabilityTransport() !== undefined) return undefined

  const transport = core.createHttpObservabilityTransport({ serverUrl })
  return core.setObservabilityTransport(transport)
}

/** Drain graph delivery best-effort before the worker process exits. */
export async function flushQualityRunnerObservability(core: QualityRunnerFlushCore, timeoutMs = 2_000): Promise<void> {
  await core.observe.flush({ timeoutMs })
}
