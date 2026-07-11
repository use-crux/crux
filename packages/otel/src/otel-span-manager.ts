import type { TraceAttributeValue, SpanStatus } from './types'
import {
  createLightweightSpanManager,
  type SpanManager,
  type SpanManagerFlushOptions,
  type SpanManagerFlushResult,
  type SpanRef,
} from './span-manager'
import type { SpanExporter } from './exporter'
import { createBoundedRegistry } from './bounded-registry'

type OtelPrimitiveAttributeValue = string | number | boolean
type OtelAttributeValue = OtelPrimitiveAttributeValue | OtelPrimitiveAttributeValue[]
type OtelSpanContextLike = { spanId: string; traceId: string }

const ACTIVE_OTEL_SPAN_MAX_ENTRIES = 10_000
const ACTIVE_OTEL_SPAN_MAX_AGE_MS = 10 * 60_000

let forceLightweightFallback = false
let warnedAboutMissingProvider = false

interface OtelSpanLike {
  spanContext(): OtelSpanContextLike
  setAttributes(attributes: Record<string, OtelAttributeValue>): void
  setStatus(status: { code: number; message?: string }): void
  recordException(error: Error | string): void
  addEvent(name: string, attributes?: Record<string, OtelAttributeValue>): void
  end(): void
}

interface OtelApiLike {
  context: {
    active(): unknown
    with<T>(context: unknown, fn: () => T): T
  }
  isSpanContextValid?: (context: OtelSpanContextLike) => boolean
  trace: {
    getTracer(name: string): {
      startSpan(name: string, options?: { attributes?: Record<string, OtelAttributeValue> }, context?: unknown): OtelSpanLike
    }
    getTracerProvider(): unknown
    setSpan(context: unknown, span: OtelSpanLike): unknown
    setSpanContext(context: unknown, spanContext: OtelSpanContextLike & { traceFlags: number; isRemote?: boolean }): unknown
    isSpanContextValid?: (context: OtelSpanContextLike) => boolean
  }
  SpanStatusCode: {
    UNSET: number
    OK: number
    ERROR: number
  }
}

interface ActiveOtelSpan {
  readonly span: OtelSpanLike
  statusSet: boolean
}

/**
 * Create a span manager backed by the globally registered OpenTelemetry tracer.
 *
 * Returns `undefined` when `@opentelemetry/api` cannot be loaded
 * synchronously. That keeps the package usable in edge runtimes that configure
 * an explicit lightweight exporter and do not install the optional peer.
 *
 * @param serviceName - Tracer name.
 * @param fallbackExporter - Optional lightweight exporter used after invalid
 * OTel span context detection. Tests pass this to observe fallback spans.
 * @returns A span manager when `@opentelemetry/api` can be loaded.
 */
export function createOpenTelemetrySpanManager(
  serviceName = '@use-crux/otel',
  fallbackExporter?: SpanExporter,
): SpanManager | undefined {
  const api = loadOpenTelemetryApi()
  if (!api) return undefined
  if (forceLightweightFallback) return createFallbackSpanManager(fallbackExporter)

  const tracer = api.trace.getTracer(serviceName)
  const activeSpans = createBoundedRegistry<string, ActiveOtelSpan>({
    maxEntries: ACTIVE_OTEL_SPAN_MAX_ENTRIES,
    maxAgeMs: ACTIVE_OTEL_SPAN_MAX_AGE_MS,
    onEvict: (_spanId, active) => {
      expireOtelSpan(active)
    },
  })
  let fallbackManager: SpanManager | undefined

  return {
    startSpan(name, attributes, parentSpanId, identity) {
      if (fallbackManager) return fallbackManager.startSpan(name, attributes, parentSpanId, identity)

      const parent = parentSpanId ? activeSpans.get(parentSpanId) : undefined
      const parentContext = parent
        ? api.trace.setSpan(api.context.active(), parent.span)
        : identity?.traceId && isValidW3cTraceId(identity.traceId)
          ? // No live parent span crosses this boundary (e.g. `run:resume` in a
            // fresh process). A remote parent context keeps the exported OTel
            // trace ID aligned with the Crux graph's `traceId` instead of
            // minting an unrelated random one, without holding any span open
            // across the boundary or coercing a Crux ID into a span ID.
            api.trace.setSpanContext(api.context.active(), {
              traceId: identity.traceId,
              spanId: randomHexId(16),
              traceFlags: 1,
              isRemote: true,
            })
          : api.context.active()
      const span = tracer.startSpan(name, otelAttributesOption(attributes), parentContext)
      const context = span.spanContext()
      if (!spanContextIsValid(api, context)) {
        span.end()
        warnAboutMissingProvider()
        forceLightweightFallback = true
        fallbackManager = createFallbackSpanManager(fallbackExporter)
        return fallbackManager.startSpan(name, attributes, parentSpanId, identity)
      }
      activeSpans.set(context.spanId, { span, statusSet: false })
      return { spanId: context.spanId, traceId: context.traceId }
    },

    setAttributes(ref, attributes) {
      if (fallbackManager) {
        fallbackManager.setAttributes(ref, attributes)
        return
      }
      const normalized = otelAttributes(attributes)
      if (normalized) activeSpans.get(ref.spanId)?.span.setAttributes(normalized)
    },

    setStatus(ref, status) {
      if (fallbackManager) {
        fallbackManager.setStatus(ref, status)
        return
      }
      const active = activeSpans.get(ref.spanId)
      if (!active) return
      active.statusSet = true
      active.span.setStatus({
        code: statusCodeFor(api, status.code),
        ...(status.message ? { message: status.message } : {}),
      })
    },

    recordError(ref, error) {
      if (fallbackManager) {
        fallbackManager.recordError(ref, error)
        return
      }
      const active = activeSpans.get(ref.spanId)
      if (!active) return
      active.statusSet = true
      active.span.recordException(error)
      active.span.setStatus({
        code: api.SpanStatusCode.ERROR,
        message: typeof error === 'string' ? error : error.message,
      })
    },

    addEvent(ref, name, attributes) {
      if (fallbackManager) {
        fallbackManager.addEvent(ref, name, attributes)
        return
      }
      activeSpans.get(ref.spanId)?.span.addEvent(name, otelAttributes(attributes))
    },

    endSpan(ref) {
      if (fallbackManager) {
        fallbackManager.endSpan(ref)
        return
      }
      const active = activeSpans.delete(ref.spanId)
      if (!active) return
      if (!active.statusSet) {
        active.span.setStatus({ code: api.SpanStatusCode.OK })
      }
      active.span.end()
    },

    runActive<T>(ref: SpanRef, fn: () => T): T {
      if (fallbackManager) return fallbackManager.runActive(ref, fn)
      const active = activeSpans.get(ref.spanId)
      if (!active) return fn()
      return api.context.with(api.trace.setSpan(api.context.active(), active.span), fn)
    },

    expireSpan(ref) {
      if (fallbackManager) {
        fallbackManager.expireSpan(ref)
        return
      }
      const active = activeSpans.delete(ref.spanId)
      if (!active) return
      expireOtelSpan(active)
    },

    async forceFlush(options) {
      if (fallbackManager) return await fallbackManager.forceFlush(options)
      return await forceFlushTracerProvider(api, options)
    },

    async shutdown() {
      if (!fallbackManager) await forceFlushTracerProvider(api, { deadlineMs: SHUTDOWN_FLUSH_DEADLINE_MS })
      activeSpans.clear()
      await fallbackManager?.shutdown()
    },
  }
}

const SHUTDOWN_FLUSH_DEADLINE_MS = 5_000

interface ForceFlushableProvider {
  forceFlush?(): Promise<void>
  /** `ProxyTracerProvider` (the global provider handle) does not itself expose `forceFlush`; unwrap to the real registered provider. */
  getDelegate?(): unknown
}

/**
 * Force-flush the globally registered TracerProvider, bounded by an optional
 * deadline.
 *
 * The base `TracerProvider` API contract does not require `forceFlush` (only
 * SDK implementations like `BasicTracerProvider`/`NodeTracerProvider` provide
 * it), so this degrades to a no-op success when the registered provider does
 * not support it — never throws through application work.
 */
async function forceFlushTracerProvider(
  api: OtelApiLike,
  options?: SpanManagerFlushOptions,
): Promise<SpanManagerFlushResult> {
  const handle = api.trace.getTracerProvider() as ForceFlushableProvider
  const delegate = (typeof handle.getDelegate === 'function' ? handle.getDelegate() : undefined) as
    | ForceFlushableProvider
    | undefined
  const provider = typeof delegate?.forceFlush === 'function' ? delegate : handle
  if (typeof provider.forceFlush !== 'function') return { flushed: 0, pending: 0, timedOut: false }

  const settle = provider
    .forceFlush()
    .then(() => false)
    .catch(() => false)
  const deadlineMs = options?.deadlineMs
  const timedOut =
    deadlineMs === undefined
      ? await settle
      : await Promise.race([
          settle,
          new Promise<boolean>((resolve) => setTimeout(() => resolve(true), Math.max(0, deadlineMs))),
        ])
  return timedOut ? { flushed: 0, pending: 1, timedOut: true } : { flushed: 1, pending: 0, timedOut: false }
}

function expireOtelSpan(active: ActiveOtelSpan): void {
  active.span.setAttributes({ 'crux.expired': true })
  active.span.end()
}

function otelAttributesOption(
  attributes: Record<string, TraceAttributeValue> | undefined,
): { readonly attributes?: Record<string, OtelAttributeValue> } | undefined {
  const normalized = otelAttributes(attributes)
  return normalized ? { attributes: normalized } : undefined
}

function otelAttributes(
  attributes: Record<string, TraceAttributeValue> | undefined,
): Record<string, OtelAttributeValue> | undefined {
  if (!attributes) return undefined
  const normalized: Record<string, OtelAttributeValue> = {}
  for (const [key, value] of Object.entries(attributes)) {
    normalized[key] = isPrimitiveAttributeArray(value) ? [...value] : value
  }
  return normalized
}

function isPrimitiveAttributeArray(value: TraceAttributeValue): value is readonly OtelPrimitiveAttributeValue[] {
  return Array.isArray(value)
}

function createFallbackSpanManager(exporter?: SpanExporter): SpanManager {
  return createLightweightSpanManager(exporter ?? {
    export: () => {},
    shutdown: async () => {},
  })
}

const HEX_TRACE_ID = /^[0-9a-f]{32}$/u
const HEX_CHARS = '0123456789abcdef'

function isValidW3cTraceId(traceId: string): boolean {
  return HEX_TRACE_ID.test(traceId) && !/^0+$/u.test(traceId)
}

/** Generate a fresh, valid W3C hex ID. Never derived from an existing Crux ID. */
function randomHexId(length: number): string {
  let id = ''
  for (let index = 0; index < length; index++) {
    id += HEX_CHARS[Math.floor(Math.random() * HEX_CHARS.length)]
  }
  return id
}

function spanContextIsValid(api: OtelApiLike, context: OtelSpanContextLike): boolean {
  const isValid = api.isSpanContextValid ?? api.trace.isSpanContextValid
  if (isValid) return isValid(context)
  return context.spanId !== '0000000000000000' && context.traceId !== '00000000000000000000000000000000'
}

function warnAboutMissingProvider(): void {
  if (warnedAboutMissingProvider) return
  warnedAboutMissingProvider = true
  console.warn(
    '[crux] No OpenTelemetry TracerProvider registered — crux telemetry will be dropped. Register a provider or pass an exporter.',
  )
}

export function __resetOpenTelemetryFallbackForTesting(): void {
  forceLightweightFallback = false
  warnedAboutMissingProvider = false
}

function statusCodeFor(api: OtelApiLike, status: SpanStatus['code']): number {
  switch (status) {
    case 'OK':
      return api.SpanStatusCode.OK
    case 'ERROR':
      return api.SpanStatusCode.ERROR
    default:
      return api.SpanStatusCode.UNSET
  }
}

function loadOpenTelemetryApi(): OtelApiLike | undefined {
  const requireModule = getRequire()
  if (!requireModule) return undefined
  try {
    return requireModule('@opentelemetry/api') as OtelApiLike
  } catch {
    return undefined
  }
}

function getRequire(): ((id: string) => unknown) | undefined {
  const runtime = globalThis as typeof globalThis & {
    require?: (id: string) => unknown
    process?: { getBuiltinModule?: (id: string) => unknown }
  }
  if (runtime.require) return runtime.require

  try {
    const nodeModule = runtime.process?.getBuiltinModule?.('node:module') as
      | { createRequire?: (url: string) => (id: string) => unknown }
      | undefined
    return nodeModule?.createRequire?.(import.meta.url)
  } catch {
    return undefined
  }
}
