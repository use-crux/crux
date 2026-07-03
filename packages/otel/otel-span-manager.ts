import type { SpanStatus } from './types'
import { createLightweightSpanManager, type SpanManager } from './span-manager'
import type { SpanExporter } from './exporter'
import { createBoundedRegistry } from './bounded-registry'

type OtelAttributeValue = string | number | boolean
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
  }
  isSpanContextValid?: (context: OtelSpanContextLike) => boolean
  trace: {
    getTracer(name: string): {
      startSpan(name: string, options?: { attributes?: Record<string, OtelAttributeValue> }, context?: unknown): OtelSpanLike
    }
    setSpan(context: unknown, span: OtelSpanLike): unknown
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
    startSpan(name, attributes, parentSpanId) {
      if (fallbackManager) return fallbackManager.startSpan(name, attributes, parentSpanId)

      const parent = parentSpanId ? activeSpans.get(parentSpanId) : undefined
      const parentContext = parent ? api.trace.setSpan(api.context.active(), parent.span) : api.context.active()
      const span = tracer.startSpan(name, attributes ? { attributes } : undefined, parentContext)
      const context = span.spanContext()
      if (!spanContextIsValid(api, context)) {
        span.end()
        warnAboutMissingProvider()
        forceLightweightFallback = true
        fallbackManager = createFallbackSpanManager(fallbackExporter)
        return fallbackManager.startSpan(name, attributes, parentSpanId)
      }
      activeSpans.set(context.spanId, { span, statusSet: false })
      return { spanId: context.spanId, traceId: context.traceId }
    },

    setAttributes(ref, attributes) {
      if (fallbackManager) {
        fallbackManager.setAttributes(ref, attributes)
        return
      }
      activeSpans.get(ref.spanId)?.span.setAttributes(attributes)
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
      activeSpans.get(ref.spanId)?.span.addEvent(name, attributes)
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

    expireSpan(ref) {
      if (fallbackManager) {
        fallbackManager.expireSpan(ref)
        return
      }
      const active = activeSpans.delete(ref.spanId)
      if (!active) return
      expireOtelSpan(active)
    },

    async shutdown() {
      activeSpans.clear()
      await fallbackManager?.shutdown()
    },
  }
}

function expireOtelSpan(active: ActiveOtelSpan): void {
  active.span.setAttributes({ 'crux.expired': true })
  active.span.end()
}

function createFallbackSpanManager(exporter?: SpanExporter): SpanManager {
  return createLightweightSpanManager(exporter ?? {
    export: () => {},
    shutdown: async () => {},
  })
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
