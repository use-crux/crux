import {
  CRUX_OBSERVABILITY_SCHEMA_VERSION,
  type CruxAttributes,
  type CruxArtifactId,
  type CruxArtifactKind,
  type CruxEdgeType,
  type CruxGraphRecord,
  type CruxGraphNodeRef,
  type CruxMetrics,
  type CruxPrimitiveFamily,
  type CruxPrimitiveName,
  type CruxRunId,
  type CruxRunStatus,
  type CruxSpanStatus,
  type CruxSpanId,
  type CruxTraceId,
} from './contract'
import {
  createCruxArtifactId,
  createCruxEdgeId,
  createCruxRecordId,
  createCruxRunId,
  createCruxSpanEventId,
  createCruxSpanId,
  createCruxTraceId,
} from './ids'
import { normalizeObservedError, observedErrorSummary } from './errors'
import { CruxGraphRecordSchema } from './schema'
import type { CruxObservabilityTransport } from './transport'

export interface ObservabilityDeliveryOptions {
  /**
   * Maximum number of in-flight transport sends. New records stay queued until
   * a delivery slot opens.
   * @default 1000
   */
  maxPendingDeliveries?: number
}

export interface ConfigureObservabilityOptions {
  transport?: CruxObservabilityTransport
  delivery?: ObservabilityDeliveryOptions
}

export interface ObservabilityDiagnostics {
  readonly pendingDeliveries: number
  readonly droppedRecords: number
  readonly deliveryErrors: readonly unknown[]
}

export interface ObservabilityFlushOptions {
  /**
   * Bound the wait so serverless shutdown paths never hang user code forever.
   * @default wait until all pending deliveries settle
   */
  timeoutMs?: number
}

export interface OpenObservedSpan {
  readonly runId: CruxRunId
  readonly traceId: CruxTraceId
  readonly spanId: CruxSpanId
  readonly parentSpanId: CruxSpanId | null
  withContext<T>(fn: () => T | Promise<T>): T | Promise<T>
  end(options?: CruxAttributes | EndObservedSpanOptions): void
  error(error: unknown, attributes?: CruxAttributes): void
}

export interface OpenObservedRun {
  readonly runId: CruxRunId
  readonly traceId: CruxTraceId
  captureContext(): CapturedObservabilityContext
  withContext<T>(fn: () => T | Promise<T>): T | Promise<T>
  end(options?: EndObservedRunOptions): void
  error(error: unknown, options?: Omit<EndObservedRunOptions, 'status' | 'error'>): void
}

export interface ObserveRunOptions {
  name: string
  rootPrimitive: CruxPrimitiveName
  attributes?: CruxAttributes
}

export interface EndObservedRunOptions {
  status?: Exclude<CruxRunStatus, 'running'>
  metrics?: CruxMetrics
  error?: unknown
  attributes?: CruxAttributes
}

export interface EndObservedSpanOptions {
  status?: Exclude<CruxSpanStatus, 'running'>
  metrics?: CruxMetrics
  error?: unknown
  attributes?: CruxAttributes
}

export interface ObserveSpanOptions {
  name: string
  family: CruxPrimitiveFamily
  primitive: CruxPrimitiveName
  attributes?: CruxAttributes
  /**
   * When a span starts outside an active run, `observe.span()` normally opens
   * an implicit run so direct primitive calls remain inspectable. Detail
   * spans can disable that behavior when they should only enrich an existing
   * run and must not become the visible run boundary themselves.
   *
   * @default true
   */
  implicitRun?: boolean
}

export interface ObserveEventOptions {
  name: string
  attributes?: CruxAttributes
}

export interface ObserveArtifactOptions {
  artifactId?: CruxArtifactId
  kind: CruxArtifactKind
  contentType: string
  encoding: 'json' | 'text' | 'bytes' | 'reference'
  sizeBytes?: number
  hash?: string
  preview?: unknown
  uri?: string
  attributes?: CruxAttributes
}

export interface ObserveEdgeOptions {
  edgeType: CruxEdgeType
  from: CruxGraphNodeRef
  to: CruxGraphNodeRef
  attributes?: CruxAttributes
}

interface ObservabilityContext {
  runId: CruxRunId
  traceId: CruxTraceId
  spanStack: readonly CruxSpanId[]
}

export interface CapturedObservabilityContext extends ObservabilityContext {
  currentSpanId?: CruxSpanId
}

type AsyncLocalStorageLike<T> = {
  run<R>(store: T, fn: () => R): R
  getStore(): T | undefined
}

let als: AsyncLocalStorageLike<ObservabilityContext> | null = null
let alsInitialized = false

let activeTransport: CruxObservabilityTransport | undefined
let deliveryOptions: Required<ObservabilityDeliveryOptions> = {
  maxPendingDeliveries: 1000,
}
const pendingDeliveries = new Set<Promise<void>>()
const deliveryErrors: unknown[] = []
const queuedRecords: CruxGraphRecord[] = []
let dispatchScheduled = false
let droppedRecords = 0
let deliveryFailureCount = 0
const microtaskFallback = Promise.resolve()

const terminalSpanStatuses = new Set<Exclude<CruxSpanStatus, 'running'>>([
  'ok',
  'error',
  'blocked',
  'cancelled',
  'suspended',
  'skipped',
])
const DELIVERY_FAILURE_RETRY_DELAY_MS = 25

function getAls(): AsyncLocalStorageLike<ObservabilityContext> | null {
  if (!alsInitialized) {
    alsInitialized = true
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const hooks = require('node:async_hooks') as typeof import('node:async_hooks')
      als = new hooks.AsyncLocalStorage<ObservabilityContext>()
    } catch {
      als = null
    }
  }
  return als
}

function currentContext(): ObservabilityContext | undefined {
  return getAls()?.getStore()
}

function withContext<R>(context: ObservabilityContext, fn: () => R): R {
  const storage = getAls()
  if (storage) return storage.run(context, fn)
  return fn()
}

function now(): string {
  return new Date().toISOString()
}

function durationSince(startedAtMs: number): number {
  return Math.max(0, Date.now() - startedAtMs)
}

function emit(record: CruxGraphRecord): void {
  CruxGraphRecordSchema.parse(record)
  if (!activeTransport) return
  queuedRecords.push(record)
  if (pendingDeliveries.size === 0) {
    dispatchQueuedRecords()
  } else if (pendingDeliveries.size < deliveryOptions.maxPendingDeliveries) {
    scheduleDispatch()
  }
}

function scheduleDispatch(): void {
  if (dispatchScheduled) return
  dispatchScheduled = true
  const enqueueMicrotask = globalThis.queueMicrotask
  if (typeof enqueueMicrotask === 'function') {
    enqueueMicrotask(dispatchQueuedRecords)
    return
  }
  void microtaskFallback.then(dispatchQueuedRecords)
}

function dispatchQueuedRecords(): void {
  dispatchScheduled = false
  const transport = activeTransport
  if (!transport) {
    queuedRecords.length = 0
    return
  }
  if (queuedRecords.length === 0) return
  if (pendingDeliveries.size >= deliveryOptions.maxPendingDeliveries) {
    return
  }
  const batch = queuedRecords.splice(0, queuedRecords.length)

  let failed = false
  const delivery = Promise.resolve(transport.send(batch))
    .catch((error: unknown) => {
      failed = true
      deliveryFailureCount += 1
      deliveryErrors.push(error)
      queuedRecords.unshift(...batch)
    })
    .finally(() => {
      pendingDeliveries.delete(delivery)
      if (!failed && queuedRecords.length > 0) scheduleDispatch()
    })
  pendingDeliveries.add(delivery)
}

function configureDelivery(options: ObservabilityDeliveryOptions | undefined): void {
  deliveryOptions = {
    maxPendingDeliveries: Math.max(1, options?.maxPendingDeliveries ?? 1000),
  }
}

function normalizeSpanEndOptions(options?: CruxAttributes | EndObservedSpanOptions): EndObservedSpanOptions {
  if (!options) return {}
  const candidate = options as EndObservedSpanOptions
  if (
    (candidate.status && terminalSpanStatuses.has(candidate.status)) ||
    candidate.metrics !== undefined ||
    candidate.error !== undefined ||
    candidate.attributes !== undefined
  ) {
    return candidate
  }
  return { attributes: options as CruxAttributes }
}

function errorContext(attributes?: CruxAttributes): {
  readonly attributes?: CruxAttributes
  readonly phase?: string
  readonly errorKind?: string
} {
  return {
    ...(attributes ? { attributes } : {}),
    ...stringAttribute(attributes, 'phase', 'phase'),
    ...stringAttribute(attributes, 'errorKind', 'errorKind'),
  }
}

function stringAttribute(attributes: CruxAttributes | undefined, key: string, outputKey: 'phase' | 'errorKind') {
  const value = attributes?.[key]
  return typeof value === 'string' && value.length > 0 ? { [outputKey]: value } : {}
}

function emitObservedErrorEvidence(
  context: ObservabilityContext,
  spanId: CruxSpanId,
  error: unknown,
  attributes?: CruxAttributes,
): void {
  const normalized = normalizeObservedError(error, errorContext(attributes))
  const stack = normalized.thrown === 'error' ? normalized.stack : undefined
  const phase = stringField(attributes, 'phase')
  const errorKind = stringField(attributes, 'errorKind') ?? normalized.summary.category
  const eventAttributes: CruxAttributes = {
    ...attributes,
    'exception.message': normalized.summary.message,
    ...(normalized.summary.name ? { 'exception.type': normalized.summary.name } : {}),
    ...(stack ? { 'exception.stacktrace': stack } : {}),
    ...(phase ? { 'error.phase': phase } : {}),
    ...(errorKind ? { 'error.kind': errorKind } : {}),
  }

  emit({
    schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
    recordId: createCruxRecordId(),
    type: 'span:event',
    runId: context.runId,
    traceId: context.traceId,
    spanId,
    eventId: createCruxSpanEventId(),
    name: 'exception',
    timestamp: now(),
    attributes: eventAttributes,
  })

  if (stack) {
    emit({
      schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
      recordId: createCruxRecordId(),
      type: 'artifact',
      runId: context.runId,
      traceId: context.traceId,
      spanId,
      artifactId: createCruxArtifactId(),
      kind: 'error.stack',
      createdAt: now(),
      contentType: 'text/plain',
      encoding: 'text',
      preview: stack,
      ...(attributes ? { attributes } : {}),
    })
  }

  emit({
    schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
    recordId: createCruxRecordId(),
    type: 'artifact',
    runId: context.runId,
    traceId: context.traceId,
    spanId,
    artifactId: createCruxArtifactId(),
    kind: 'error.raw',
    createdAt: now(),
    contentType: 'application/json',
    encoding: 'json',
    preview: normalized.raw,
    ...(attributes ? { attributes } : {}),
  })
}

function stringField(record: CruxAttributes | undefined, key: string): string | undefined {
  const value = record?.[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function configureObservability(options: ConfigureObservabilityOptions): () => void {
  const previous = activeTransport
  const previousDeliveryOptions = deliveryOptions
  activeTransport = options.transport
  configureDelivery(options.delivery)
  return () => {
    activeTransport = previous
    deliveryOptions = previousDeliveryOptions
  }
}

export function setObservabilityTransport(
  transport: CruxObservabilityTransport | undefined,
  options?: ObservabilityDeliveryOptions,
): () => void {
  return configureObservability({ transport, delivery: options })
}

export function resetObservabilityRuntime(): void {
  activeTransport = undefined
  configureDelivery(undefined)
  queuedRecords.length = 0
  dispatchScheduled = false
  pendingDeliveries.clear()
  deliveryErrors.length = 0
  droppedRecords = 0
  deliveryFailureCount = 0
}

export function observabilityDeliveryErrors(): readonly unknown[] {
  return deliveryErrors
}

export function observabilityDiagnostics(): ObservabilityDiagnostics {
  return {
    pendingDeliveries: pendingDeliveries.size,
    droppedRecords,
    deliveryErrors,
  }
}

function timeoutSignal(timeoutMs: number): { promise: Promise<false>; cancel: () => void } {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const promise = new Promise<false>((resolve) => {
    timeout = setTimeout(() => {
      timeout = undefined
      resolve(false)
    }, timeoutMs)
  })
  return {
    promise,
    cancel() {
      if (timeout === undefined) return
      clearTimeout(timeout)
      timeout = undefined
    },
  }
}

export const observe = {
  openRun(options: ObserveRunOptions): OpenObservedRun {
    const runId = createCruxRunId()
    const traceId = createCruxTraceId()
    const startedAtMs = Date.now()
    const context: ObservabilityContext = { runId, traceId, spanStack: [] }
    let ended = false

    emit({
      schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
      recordId: createCruxRecordId(),
      type: 'run:start',
      runId,
      traceId,
      name: options.name,
      rootPrimitive: options.rootPrimitive,
      startedAt: now(),
      status: 'running',
      ...(options.attributes ? { attributes: options.attributes } : {}),
    })

    const finish = (finishOptions: EndObservedRunOptions = {}): void => {
      if (ended) return
      ended = true
      const status = finishOptions.status ?? (finishOptions.error ? 'error' : 'ok')
      emit({
        schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
        recordId: createCruxRecordId(),
        type: 'run:end',
        runId,
        traceId,
        endedAt: now(),
        durationMs: durationSince(startedAtMs),
        status,
        ...(finishOptions.metrics ? { metrics: finishOptions.metrics } : {}),
        ...(finishOptions.error !== undefined
          ? { error: observedErrorSummary(finishOptions.error, errorContext(finishOptions.attributes)) }
          : {}),
        ...(finishOptions.attributes ? { attributes: finishOptions.attributes } : {}),
      })
    }

    return {
      runId,
      traceId,
      captureContext(): CapturedObservabilityContext {
        return { ...context, spanStack: [] }
      },
      withContext<T>(fn: () => T | Promise<T>): T | Promise<T> {
        return withContext(context, fn)
      },
      end(options?: EndObservedRunOptions): void {
        finish(options)
      },
      error(error: unknown, options?: Omit<EndObservedRunOptions, 'status' | 'error'>): void {
        finish({ ...options, status: 'error', error })
      },
    }
  },

  endRun(context: CapturedObservabilityContext, options: EndObservedRunOptions = {}): void {
    const status = options.status ?? (options.error ? 'error' : 'ok')
    emit({
      schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
      recordId: createCruxRecordId(),
      type: 'run:end',
      runId: context.runId,
      traceId: context.traceId,
      endedAt: now(),
      status,
      ...(options.metrics ? { metrics: options.metrics } : {}),
      ...(options.error !== undefined ? { error: observedErrorSummary(options.error, errorContext(options.attributes)) } : {}),
      ...(options.attributes ? { attributes: options.attributes } : {}),
    })
  },

  async run<T>(options: ObserveRunOptions, fn: () => T | Promise<T>): Promise<T> {
    const runId = createCruxRunId()
    const traceId = createCruxTraceId()
    const startedAtMs = Date.now()
    const context: ObservabilityContext = { runId, traceId, spanStack: [] }

    emit({
      schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
      recordId: createCruxRecordId(),
      type: 'run:start',
      runId,
      traceId,
      name: options.name,
      rootPrimitive: options.rootPrimitive,
      startedAt: now(),
      status: 'running',
      ...(options.attributes ? { attributes: options.attributes } : {}),
    })

    try {
      const result = await withContext(context, fn)
      emit({
        schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
        recordId: createCruxRecordId(),
        type: 'run:end',
        runId,
        traceId,
        endedAt: now(),
        durationMs: durationSince(startedAtMs),
        status: 'ok',
      })
      return result
    } catch (error) {
      emit({
        schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
        recordId: createCruxRecordId(),
        type: 'run:end',
        runId,
        traceId,
        endedAt: now(),
        durationMs: durationSince(startedAtMs),
        status: 'error',
        error: observedErrorSummary(error, errorContext(options.attributes)),
      })
      throw error
    }
  },

  async span<T>(options: ObserveSpanOptions, fn: () => T | Promise<T>): Promise<T> {
    const context = currentContext()
    if (!context) {
      if (options.implicitRun === false) return await fn()
      return await observe.run(
        { name: options.name, rootPrimitive: options.primitive, attributes: options.attributes },
        () => observe.span(options, fn),
      )
    }

    const spanId = createCruxSpanId()
    const parentSpanId = context.spanStack[context.spanStack.length - 1] ?? null
    const nextContext: ObservabilityContext = {
      ...context,
      spanStack: [...context.spanStack, spanId],
    }
    const startedAtMs = Date.now()

    emit({
      schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
      recordId: createCruxRecordId(),
      type: 'span:start',
      runId: context.runId,
      traceId: context.traceId,
      spanId,
      parentSpanId,
      family: options.family,
      primitive: options.primitive,
      name: options.name,
      startedAt: now(),
      status: 'running',
      ...(options.attributes ? { attributes: options.attributes } : {}),
    })

    try {
      const result = await withContext(nextContext, fn)
      emit({
        schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
        recordId: createCruxRecordId(),
        type: 'span:end',
        runId: context.runId,
        traceId: context.traceId,
        spanId,
        endedAt: now(),
        durationMs: durationSince(startedAtMs),
        status: 'ok',
      })
      return result
    } catch (error) {
      emitObservedErrorEvidence(nextContext, spanId, error, options.attributes)
      emit({
        schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
        recordId: createCruxRecordId(),
        type: 'span:end',
        runId: context.runId,
        traceId: context.traceId,
        spanId,
        endedAt: now(),
        durationMs: durationSince(startedAtMs),
        status: 'error',
        error: observedErrorSummary(error, errorContext(options.attributes)),
        ...(options.attributes ? { attributes: options.attributes } : {}),
      })
      throw error
    }
  },

  openSpan(options: ObserveSpanOptions): OpenObservedSpan {
    let context = currentContext()
    let openedImplicitRun = false
    let implicitRunStartedAtMs = 0
    if (!context) {
      if (options.implicitRun === false) {
        const runId = createCruxRunId()
        const traceId = createCruxTraceId()
        const spanId = createCruxSpanId()
        return {
          runId,
          traceId,
          spanId,
          parentSpanId: null,
          withContext<T>(fn: () => T | Promise<T>): T | Promise<T> {
            return fn()
          },
          end(): void {},
          error(): void {},
        }
      }
      openedImplicitRun = true
      implicitRunStartedAtMs = Date.now()
      context = {
        runId: createCruxRunId(),
        traceId: createCruxTraceId(),
        spanStack: [],
      }
      emit({
        schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
        recordId: createCruxRecordId(),
        type: 'run:start',
        runId: context.runId,
        traceId: context.traceId,
        name: options.name,
        rootPrimitive: options.primitive,
        startedAt: now(),
        status: 'running',
        ...(options.attributes ? { attributes: options.attributes } : {}),
      })
    }

    const spanId = createCruxSpanId()
    const parentSpanId = context.spanStack[context.spanStack.length - 1] ?? null
    const spanContext: ObservabilityContext = {
      ...context,
      spanStack: [...context.spanStack, spanId],
    }
    const startedAtMs = Date.now()
    let ended = false

    emit({
      schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
      recordId: createCruxRecordId(),
      type: 'span:start',
      runId: context.runId,
      traceId: context.traceId,
      spanId,
      parentSpanId,
      family: options.family,
      primitive: options.primitive,
      name: options.name,
      startedAt: now(),
      status: 'running',
      ...(options.attributes ? { attributes: options.attributes } : {}),
    })

    const mergeSpanAttributes = (finishAttributes?: CruxAttributes): CruxAttributes | undefined => {
      if (!options.attributes && !finishAttributes) return undefined
      return {
        ...(options.attributes ?? {}),
        ...(finishAttributes ?? {}),
      }
    }

    const finish = (finishOptions: EndObservedSpanOptions = {}): void => {
      if (ended) return
      ended = true
      const status = finishOptions.status ?? (finishOptions.error ? 'error' : 'ok')
      const attributes = mergeSpanAttributes(finishOptions.attributes)
      if (finishOptions.error !== undefined) {
        emitObservedErrorEvidence(spanContext, spanId, finishOptions.error, attributes)
      }
      emit({
        schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
        recordId: createCruxRecordId(),
        type: 'span:end',
        runId: spanContext.runId,
        traceId: spanContext.traceId,
        spanId,
        endedAt: now(),
        durationMs: durationSince(startedAtMs),
        status,
        ...(finishOptions.metrics ? { metrics: finishOptions.metrics } : {}),
        ...(finishOptions.error !== undefined
          ? { error: observedErrorSummary(finishOptions.error, errorContext(attributes)) }
          : {}),
        ...(attributes ? { attributes } : {}),
      })
      if (openedImplicitRun) {
        const runStatus: Exclude<CruxRunStatus, 'running'> = status === 'skipped' ? 'ok' : status
        emit({
          schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
          recordId: createCruxRecordId(),
          type: 'run:end',
          runId: spanContext.runId,
          traceId: spanContext.traceId,
          endedAt: now(),
          durationMs: durationSince(implicitRunStartedAtMs),
          status: runStatus,
          ...(finishOptions.metrics ? { metrics: finishOptions.metrics } : {}),
          ...(finishOptions.error !== undefined
            ? { error: observedErrorSummary(finishOptions.error, errorContext(attributes)) }
            : {}),
        })
      }
    }

    return {
      runId: spanContext.runId,
      traceId: spanContext.traceId,
      spanId,
      parentSpanId,
      withContext<T>(fn: () => T | Promise<T>): T | Promise<T> {
        return withContext(spanContext, fn)
      },
      end(options?: CruxAttributes | EndObservedSpanOptions): void {
        finish(normalizeSpanEndOptions(options))
      },
      error(error: unknown, attributes?: CruxAttributes): void {
        finish({ status: 'error', error, attributes })
      },
    }
  },

  event(options: ObserveEventOptions): void {
    const context = currentContext()
    const spanId = context?.spanStack[context.spanStack.length - 1]
    if (!context || !spanId) return

    emit({
      schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
      recordId: createCruxRecordId(),
      type: 'span:event',
      runId: context.runId,
      traceId: context.traceId,
      spanId,
      eventId: createCruxSpanEventId(),
      name: options.name,
      timestamp: now(),
      ...(options.attributes ? { attributes: options.attributes } : {}),
    })
  },

  artifact(options: ObserveArtifactOptions): CruxArtifactId | undefined {
    const context = currentContext()
    if (!context) return undefined

    const artifactId = options.artifactId ?? createCruxArtifactId()
    const spanId = context.spanStack[context.spanStack.length - 1]
    emit({
      schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
      recordId: createCruxRecordId(),
      type: 'artifact',
      runId: context.runId,
      traceId: context.traceId,
      artifactId,
      ...(spanId ? { spanId } : {}),
      kind: options.kind,
      createdAt: now(),
      contentType: options.contentType,
      encoding: options.encoding,
      ...(options.sizeBytes !== undefined ? { sizeBytes: options.sizeBytes } : {}),
      ...(options.hash ? { hash: options.hash } : {}),
      ...(options.preview !== undefined ? { preview: options.preview } : {}),
      ...(options.uri ? { uri: options.uri } : {}),
      ...(options.attributes ? { attributes: options.attributes } : {}),
    })
    return artifactId
  },

  edge(options: ObserveEdgeOptions): void {
    const context = currentContext()
    if (!context) return

    emit({
      schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
      recordId: createCruxRecordId(),
      type: 'edge',
      runId: context.runId,
      traceId: context.traceId,
      edgeId: createCruxEdgeId(),
      edgeType: options.edgeType,
      from: options.from,
      to: options.to,
      createdAt: now(),
      ...(options.attributes ? { attributes: options.attributes } : {}),
    })
  },

  captureContext(): CapturedObservabilityContext | undefined {
    const context = currentContext()
    if (!context) return undefined
    const currentSpanId = context.spanStack[context.spanStack.length - 1]
    return {
      runId: context.runId,
      traceId: context.traceId,
      spanStack: [...context.spanStack],
      ...(currentSpanId ? { currentSpanId } : {}),
    }
  },

  withContext<T>(context: CapturedObservabilityContext | undefined, fn: () => T | Promise<T>): T | Promise<T> {
    if (!context) return fn()
    return withContext(
      {
        runId: context.runId,
        traceId: context.traceId,
        spanStack: [...context.spanStack],
      },
      fn,
    )
  },

  async flush(options: ObservabilityFlushOptions = {}): Promise<boolean> {
    const deadline = options.timeoutMs === undefined ? undefined : Date.now() + options.timeoutMs
    let failuresThisFlush = 0
    while (queuedRecords.length > 0 || dispatchScheduled || pendingDeliveries.size > 0) {
      const failuresBefore = deliveryFailureCount
      if (queuedRecords.length > 0 || dispatchScheduled) {
        dispatchQueuedRecords()
      }
      const pending = Promise.all([...pendingDeliveries]).then(() => true)
      const remaining = deadline === undefined ? undefined : Math.max(0, deadline - Date.now())
      let completed: boolean
      if (remaining === undefined) {
        completed = await pending
      } else {
        const timeout = timeoutSignal(remaining)
        try {
          completed = await Promise.race([pending, timeout.promise])
        } finally {
          timeout.cancel()
        }
      }
      if (!completed) return false
      if (deliveryFailureCount > failuresBefore && queuedRecords.length > 0) {
        failuresThisFlush += deliveryFailureCount - failuresBefore
        if (deadline === undefined && failuresThisFlush > 3) return false
        const remaining = deadline === undefined ? undefined : deadline - Date.now()
        if (remaining !== undefined && remaining <= 0) return false
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(DELIVERY_FAILURE_RETRY_DELAY_MS, remaining ?? DELIVERY_FAILURE_RETRY_DELAY_MS)),
        )
      }
    }
    return true
  },

  async shutdown(options: ObservabilityFlushOptions = {}): Promise<boolean> {
    const flushed = await observe.flush(options)
    activeTransport = undefined
    return flushed
  },
}
