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
    let runtime
    let program
    try {
      runtime = await loadRuntimeWorkerHost({ root })
      if (shutdown.requested()) return
      program = await loadGeneratedRuntimeProgram(root)
      if (shutdown.requested()) return
    } catch (error) {
      if (shutdown.requested()) return
      throw error
    }
    worker = createRuntimeWorker({ runtime, program })
    await Promise.race([worker.closed, shutdown.received])
  } finally {
    shutdown.dispose()
    await worker?.stop({ timeoutMs: RUNTIME_WORKER_SHUTDOWN_TIMEOUT_MS })
  }
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
