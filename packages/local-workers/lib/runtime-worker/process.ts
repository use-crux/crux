import { createRuntimeWorker, type RuntimeWorker } from '@use-crux/core/runtime'
import { loadRuntimeWorkerHost } from '@use-crux/indexer/host/runtime'
import { loadGeneratedRuntimeProgram } from './program-loader'

/** Maximum time the process waits for active Runtime work during shutdown. */
export const RUNTIME_WORKER_SHUTDOWN_TIMEOUT_MS = 10_000

/** Run exactly one configured Runtime execution worker until interrupted or failed. */
export async function runRuntimeWorkerProcess(root: string): Promise<void> {
  const shutdown = watchShutdownSignals()
  let worker: RuntimeWorker | undefined
  try {
    const runtime = await loadUntilShutdown(loadRuntimeWorkerHost({ root }), shutdown)
    if (!runtime) return exitAfterStartupShutdown()
    const program = await loadUntilShutdown(loadGeneratedRuntimeProgram(root), shutdown)
    if (!program) return exitAfterStartupShutdown()
    worker = createRuntimeWorker({ runtime, program })
    await Promise.race([worker.closed, shutdown.received])
  } finally {
    shutdown.dispose()
    await worker?.stop({ timeoutMs: RUNTIME_WORKER_SHUTDOWN_TIMEOUT_MS })
  }
}

async function loadUntilShutdown<T>(
  loading: Promise<T>,
  shutdown: ReturnType<typeof watchShutdownSignals>,
): Promise<T | undefined> {
  const loaded = await Promise.race([
    loading.then((value) => ({ value })),
    shutdown.received.then(() => undefined),
  ])
  if (!loaded) {
    void loading.catch(() => undefined)
    return undefined
  }
  return loaded.value
}

function exitAfterStartupShutdown(): never {
  process.exit(0)
}

function watchShutdownSignals(): {
  readonly received: Promise<void>
  readonly requested: () => boolean
  readonly dispose: () => void
} {
  let requested = false
  let resolveReceived!: () => void
  const received = new Promise<void>((resolve) => {
    resolveReceived = resolve
  })
  const stop = (): void => {
    requested = true
    resolveReceived()
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  return {
    received,
    requested: () => requested,
    dispose() {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
    },
  }
}
