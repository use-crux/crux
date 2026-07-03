import type { CruxRunId, CruxSpanId, CruxTraceId } from './contract'
import { mergeCruxCorrelators, type CruxCorrelators } from './correlators'

export interface ObservabilityContext {
  runId: CruxRunId
  traceId: CruxTraceId
  startedAtMs?: number
  spanStack: readonly CruxSpanId[]
  correlators?: CruxCorrelators
}

export interface CapturedObservabilityContext extends ObservabilityContext {
  currentSpanId?: CruxSpanId
}

type AsyncLocalStorageLike<T> = {
  run<R>(store: T, fn: () => R): R
  getStore(): T | undefined
}

interface ObservabilityContextFrame {
  readonly context?: ObservabilityContext
  readonly correlators?: CruxCorrelators
}

let als: AsyncLocalStorageLike<ObservabilityContextFrame> | null = null
let alsInitialized = false
let synchronousFallbackFrame: ObservabilityContextFrame | undefined
let warnedAboutMissingAls = false

/**
 * Force AsyncLocalStorage availability for observability runtime tests.
 *
 * Passing `null` simulates browser/edge runtimes where `node:async_hooks` is
 * unavailable. Passing `'auto'` restores normal runtime detection.
 *
 * @internal
 */
export function __setAlsForTesting(mode: 'auto' | null): void {
  synchronousFallbackFrame = undefined
  warnedAboutMissingAls = false
  if (mode === 'auto') {
    als = null
    alsInitialized = false
    return
  }
  als = null
  alsInitialized = true
}

/** Return the active observability context, including synchronous no-ALS fallback state. */
export function currentObservabilityContext(): ObservabilityContext | undefined {
  return currentFrame()?.context
}

/** Return the active correlators, whether or not a run context exists yet. */
export function currentCruxCorrelators(): CruxCorrelators | undefined {
  return currentFrame()?.correlators
}

/**
 * Run a callback under an observability context.
 *
 * Without AsyncLocalStorage, the context is available only during the
 * synchronous call frame. Promise continuations intentionally do not inherit
 * it because browser/edge runtimes have no async context primitive here.
 */
export function withObservabilityContext<R>(context: ObservabilityContext, fn: () => R): R {
  const previousFrame = currentFrame()
  const frame = {
    ...previousFrame,
    context,
    correlators: context.correlators ?? previousFrame?.correlators,
  }
  return withFrame(frame, fn)
}

/**
 * Run a callback under additional correlators.
 *
 * Correlator-only scopes are valid before a run exists; the next run/span
 * created inside the callback inherits the merged values.
 */
export function withCruxCorrelators<R>(correlators: CruxCorrelators, fn: () => R): R {
  const previousFrame = currentFrame()
  const merged = mergeCruxCorrelators(previousFrame?.correlators, correlators)
  const context = previousFrame?.context ? { ...previousFrame.context, correlators: merged } : undefined
  return withFrame({ ...previousFrame, context, correlators: merged }, fn)
}

function withFrame<R>(frame: ObservabilityContextFrame, fn: () => R): R {
  const storage = getAls()
  if (storage) return storage.run(frame, fn)
  const previousFrame = synchronousFallbackFrame
  synchronousFallbackFrame = frame
  try {
    return fn()
  } finally {
    synchronousFallbackFrame = previousFrame
  }
}

function currentFrame(): ObservabilityContextFrame | undefined {
  return getAls()?.getStore() ?? synchronousFallbackFrame
}

function getAls(): AsyncLocalStorageLike<ObservabilityContextFrame> | null {
  if (!alsInitialized) {
    alsInitialized = true
    try {
      // `process.getBuiltinModule` works in BOTH module systems (Node >= 20.16);
      // bare `require` only exists in CJS. Keep `require` as the CJS fallback.
      const getBuiltinModule = (
        globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }
      ).process?.getBuiltinModule
      const hooks = (getBuiltinModule?.('node:async_hooks') ??
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('node:async_hooks')) as typeof import('node:async_hooks')
      als = new hooks.AsyncLocalStorage<ObservabilityContextFrame>()
    } catch {
      als = null
    }
  }
  if (!als) warnAboutMissingAlsOnce()
  return als
}

function warnAboutMissingAlsOnce(): void {
  if (warnedAboutMissingAls) return
  if (!shouldWarnAboutRuntimeLimitations()) return
  warnedAboutMissingAls = true
  console.warn(
    '[crux] AsyncLocalStorage is unavailable; observability context propagation is limited to synchronous withContext calls.',
  )
}

function shouldWarnAboutRuntimeLimitations(): boolean {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Readonly<Record<string, string | undefined>> }
  }
  const nodeEnv = runtime.process?.env?.NODE_ENV
  return nodeEnv !== 'production' && nodeEnv !== 'test'
}
