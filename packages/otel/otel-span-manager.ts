import type { SpanStatus } from './types'
import type { SpanManager } from './span-manager'

type OtelAttributeValue = string | number | boolean

interface OtelSpanLike {
  spanContext(): { spanId: string; traceId: string }
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
  trace: {
    getTracer(name: string): {
      startSpan(name: string, options?: { attributes?: Record<string, OtelAttributeValue> }, context?: unknown): OtelSpanLike
    }
    setSpan(context: unknown, span: OtelSpanLike): unknown
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
 */
export function createOpenTelemetrySpanManager(serviceName = '@use-crux/otel'): SpanManager | undefined {
  const api = loadOpenTelemetryApi()
  if (!api) return undefined

  const tracer = api.trace.getTracer(serviceName)
  const activeSpans = new Map<string, ActiveOtelSpan>()

  return {
    startSpan(name, attributes, parentSpanId) {
      const parent = parentSpanId ? activeSpans.get(parentSpanId) : undefined
      const parentContext = parent ? api.trace.setSpan(api.context.active(), parent.span) : api.context.active()
      const span = tracer.startSpan(name, attributes ? { attributes } : undefined, parentContext)
      const context = span.spanContext()
      activeSpans.set(context.spanId, { span, statusSet: false })
      return { spanId: context.spanId, traceId: context.traceId }
    },

    setAttributes(ref, attributes) {
      activeSpans.get(ref.spanId)?.span.setAttributes(attributes)
    },

    setStatus(ref, status) {
      const active = activeSpans.get(ref.spanId)
      if (!active) return
      active.statusSet = true
      active.span.setStatus({
        code: statusCodeFor(api, status.code),
        ...(status.message ? { message: status.message } : {}),
      })
    },

    recordError(ref, error) {
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
      activeSpans.get(ref.spanId)?.span.addEvent(name, attributes)
    },

    endSpan(ref) {
      const active = activeSpans.get(ref.spanId)
      if (!active) return
      activeSpans.delete(ref.spanId)
      if (!active.statusSet) {
        active.span.setStatus({ code: api.SpanStatusCode.OK })
      }
      active.span.end()
    },

    async shutdown() {
      activeSpans.clear()
    },
  }
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
