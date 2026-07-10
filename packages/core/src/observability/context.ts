import type { CruxRunId, CruxSegmentId, CruxSpanId, CruxTraceId } from './contract'
import { mergeCruxCorrelators, type CruxCorrelators } from './correlators'
import {
  __setContextStorageResolverForTesting,
  createContextStorageResolver,
  runWithSynchronousContext,
} from '../shared/context-storage'

export interface ObservabilityContext {
  runId: CruxRunId
  traceId: CruxTraceId
  segmentId: CruxSegmentId
  startedAtMs?: number
  spanStack: readonly CruxSpanId[]
  correlators?: CruxCorrelators
}

export interface CapturedObservabilityContext extends ObservabilityContext {
  currentSpanId?: CruxSpanId
}

interface ObservabilityContextFrame {
  readonly context?: ObservabilityContext
  readonly correlators?: CruxCorrelators
}

const contextStorage = createContextStorageResolver<ObservabilityContextFrame>()
const synchronousFallbackStack: ObservabilityContextFrame[] = []
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
  synchronousFallbackStack.length = 0
  warnedAboutMissingAls = false
  if (mode === 'auto') {
    __setContextStorageResolverForTesting(undefined)
    return
  }
  __setContextStorageResolverForTesting(() => undefined)
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
  const storage = getStorage()
  if (storage) return storage.run(frame, fn)
  return runWithSynchronousContext(synchronousFallbackStack, frame, fn)
}

function currentFrame(): ObservabilityContextFrame | undefined {
  return getStorage()?.get() ?? synchronousFallbackStack.at(-1)
}

function getStorage() {
  const storage = contextStorage.getStorage()
  if (!storage) warnAboutMissingAlsOnce()
  return storage
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
