/**
 * Provider-neutral Runtime worker lifecycle.
 *
 * @module
 */

import { createRuntime } from '../api/create-runtime'
import type { ResolvedRuntimeEngine } from '../api/create-runtime'
import type { InProcessRuntimeEngineDefinition } from '../api/runtime-definition'
import type { RuntimeStoreAdapter } from '../store'
import type { RuntimeProgram } from '../program'
import { normalizeRuntimeHandlerTargets } from '../handler/targets'
import type { RuntimeTargetRuntimeRef } from '../api/target-registry'
import { createRuntimeError } from '../engine/errors'
import { acquireRuntimeWorkerOwnership } from './ownership'

const DEFAULT_STOP_TIMEOUT_MS = 10_000

/** Options for creating a process-local Runtime worker. */
export interface CreateRuntimeWorkerOptions<
  TStore extends RuntimeStoreAdapter = RuntimeStoreAdapter,
> {
  /** In-process Runtime composer whose store and wake ports the worker owns. */
  readonly runtime: InProcessRuntimeEngineDefinition<TStore>
  /** Immutable program defining the only targets this worker may execute. */
  readonly program: RuntimeProgram
  /** Interval between maintenance passes. Defaults to the composer interval, then 1000ms. */
  readonly pollIntervalMs?: number
}

/** Process-local worker running one immutable Runtime program. */
export interface RuntimeWorker<
  TStore extends RuntimeStoreAdapter = RuntimeStoreAdapter,
> {
  /** Immutable program whose targets the worker may execute. */
  readonly program: RuntimeProgram
  /** Executable Runtime resolved for this worker. */
  readonly runtime: ResolvedRuntimeEngine<TStore>
  /** Resolves after stop; rejects after fatal maintenance or a stop timeout. */
  readonly closed: Promise<void>
  /**
   * Stop future ticks, await the active tick up to a bound, and dispose the Runtime.
   *
   * Calls are idempotent. A timeout rejects without claiming that external work
   * already started by the active tick was physically cancelled.
   */
  readonly stop: (options?: RuntimeWorkerStopOptions) => Promise<void>
}

/** Options for stopping a Runtime worker. */
export interface RuntimeWorkerStopOptions {
  /** Maximum time to await an active maintenance tick. Defaults to 10000ms. */
  readonly timeoutMs?: number
}

/**
 * Create and immediately start a process-local worker for one Runtime program.
 *
 * The worker resolves executable targets only from `program.targets`, disables
 * composer-owned maintenance, and runs its own immediate serial maintenance
 * loop. One worker may own a store and namespace in the current process.
 * `program.transports` remain inert.
 *
 * @param options - In-process runtime, immutable program, and optional polling override.
 * @returns An immutable worker handle whose `closed` promise tracks its lifecycle.
 * @throws A Runtime error when the program cannot resolve or ownership is active.
 * @throws A `RangeError` when `pollIntervalMs` is not positive and finite.
 */
export function createRuntimeWorker<TStore extends RuntimeStoreAdapter>(
  options: CreateRuntimeWorkerOptions<TStore>,
): RuntimeWorker<TStore> {
  const pollIntervalMs = resolvePollInterval(options)
  const runtimeRef: RuntimeTargetRuntimeRef = {}
  const targets = normalizeRuntimeHandlerTargets({
    targets: options.program.targets,
    runtimeRef,
    entry: 'createRuntimeWorker()',
  })
  const runtime = createRuntime({
    runtime: options.runtime,
    targets,
    startMaintenance: false,
  })
  runtimeRef.current = runtime
  let releaseOwnership: () => void
  try {
    releaseOwnership = acquireRuntimeWorkerOwnership(
      runtime.store,
      runtime.namespace,
    )
  } catch (error) {
    runtime.dispose()
    throw error
  }

  let state: 'running' | 'stopping' | 'closed' = 'running'
  let timer: ReturnType<typeof setTimeout> | undefined
  let activeTick: Promise<void> | undefined
  let stopPromise: Promise<void> | undefined
  let fatalFailure: { readonly error: unknown } | undefined
  let resolveClosed!: () => void
  let rejectClosed!: (reason: unknown) => void
  const closed = new Promise<void>((resolve, reject) => {
    resolveClosed = resolve
    rejectClosed = reject
  })
  void closed.catch(() => undefined)

  const closeAfterFailure = (error: unknown): void => {
    if (state === 'closed') return
    fatalFailure = { error }
    state = 'closed'
    if (timer) clearTimeout(timer)
    runtime.maintenance.stop()
    runtime.dispose()
    releaseOwnership()
    rejectClosed(error)
  }
  const tick = async (): Promise<void> => {
    if (state !== 'running') return
    try {
      await runtime.maintenance.tick()
    } catch (error) {
      closeAfterFailure(error)
      return
    }
    if (state === 'running') {
      timer = setTimeout(startTick, pollIntervalMs)
      timer.unref?.()
    }
  }
  const startTick = (): void => {
    activeTick = tick().finally(() => {
      activeTick = undefined
    })
  }

  const worker = Object.freeze({
    program: options.program,
    runtime,
    closed,
    stop(stopOptions: RuntimeWorkerStopOptions = {}): Promise<void> {
      if (stopPromise) return stopPromise
      if (state === 'closed') return closed
      const timeoutMs = resolveStopTimeout(stopOptions.timeoutMs)
      state = 'stopping'
      if (timer) clearTimeout(timer)
      runtime.maintenance.stop()
      stopPromise = (async () => {
        if (activeTick && !(await settlesWithin(activeTick, timeoutMs))) {
          const error = stopTimeoutError(timeoutMs)
          runtime.dispose()
          releaseOwnership()
          state = 'closed'
          rejectClosed(error)
          throw error
        }
        if (fatalFailure) throw fatalFailure.error
        runtime.dispose()
        releaseOwnership()
        state = 'closed'
        resolveClosed()
      })()
      return stopPromise
    },
  })

  startTick()
  return worker
}

function resolvePollInterval(options: CreateRuntimeWorkerOptions): number {
  const interval =
    options.pollIntervalMs ?? options.runtime.maintenance?.intervalMs ?? 1_000
  if (!Number.isFinite(interval) || interval <= 0) {
    throw new RangeError('pollIntervalMs must be a positive finite number.')
  }
  return interval
}

function resolveStopTimeout(timeoutMs: number | undefined): number {
  const timeout = timeoutMs ?? DEFAULT_STOP_TIMEOUT_MS
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new RangeError('timeoutMs must be a positive finite number.')
  }
  return timeout
}

async function settlesWithin(
  work: Promise<void>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs)
  })
  const settled = await Promise.race([work.then(() => true), timeout])
  if (timer) clearTimeout(timer)
  return settled
}

function stopTimeoutError(
  timeoutMs: number,
): ReturnType<typeof createRuntimeError> {
  return createRuntimeError({
    code: 'CAPABILITY_MISSING',
    whatFailed: `The active maintenance tick did not settle within ${timeoutMs}ms and was not cancelled.`,
    why: 'Runtime workers can bound shutdown waiting, but cannot physically cancel external work already started by a target or store adapter.',
    whatStillWorks:
      'Future maintenance ticks are stopped, the resolved runtime is disposed, and process-local ownership is released.',
    nextStep:
      'Inspect the active target or store operation, then increase timeoutMs only if that operation is expected to finish safely.',
  })
}
