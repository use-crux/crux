/**
 * Telemetry plugin for Crux.
 *
 * `withTelemetry()` returns a `CruxPlugin` that instruments all Crux
 * operations with OpenTelemetry spans or lightweight structured traces.
 *
 * @module
 */

import type { CruxPlugin, TelemetryFlushHookResult } from '@use-crux/core'
import { remainingHostDeadlineMs } from '@use-crux/core'
import { activeHostLifecycle, subscribeObservability, type CruxPropagationCarrier } from '@use-crux/core/observability'
import type { TraceSpan } from './types'
import { createCallbackExporter, createUrlExporter, type SpanExporter } from './exporter'
import { createLightweightSpanManager, type SpanManager, type SpanManagerFlushOptions } from './span-manager'
import { createOpenTelemetrySpanManager } from './otel-span-manager'
import { createOtelRecordSubscriber, createSpanRegistry } from './record-mapper'
import { createSpanActivationHook } from './activation'
import { baggageAttributesFromCarrier } from './propagation'

let telemetryInstalled = false
let warnedAboutDoubleInstall = false

// ─────────────────────────────────────────────────────────────────
// Configuration types
// ─────────────────────────────────────────────────────────────────

/** URL-based exporter for ephemeral runtimes. */
export interface UrlExporter {
  /** Endpoint to POST span batches to. */
  url: string
  /** Optional headers (e.g., API keys). */
  headers?: Record<string, string>
}

/** Callback exporter for custom handling. */
export type CallbackExporter = (spans: ReadonlyArray<TraceSpan>) => void | Promise<void>

/**
 * Configuration options for `withTelemetry()`.
 *
 * @example
 * ```ts
 * // Standard OTel path (Node.js server)
 * withTelemetry({ serviceName: 'my-app' })
 *
 * // Lightweight path (Lambda, Convex)
 * withTelemetry({
 *   serviceName: 'my-app',
 *   exporter: { url: 'https://collector.example.com/v1/traces' },
 * })
 *
 * // Callback path
 * withTelemetry({
 *   serviceName: 'my-app',
 *   exporter: (spans) => myLogger.send(spans),
 * })
 * ```
 */
export interface TelemetryOptions {
  /**
   * Service name for span identification.
   * Used as the OTel tracer name or included in lightweight span metadata.
   * @default '@use-crux/otel'
   */
  serviceName?: string

  /** Custom attributes added to every span. */
  attributes?: Record<string, string>

  /**
   * Emit generation message content as GenAI semconv attributes.
   *
   * Content capture is disabled by default. When enabled, generation input and
   * output artifacts are projected to `gen_ai.input.messages`,
   * `gen_ai.output.messages`, and `gen_ai.system_instructions`, capped at 32KB
   * per attribute.
   */
  captureMessageContent?: boolean

  /**
   * Forward compatibility knob for the pinned GenAI semconv table.
   *
   * Only the current package table is accepted in this beta; future versions can
   * widen this union without changing the rest of the telemetry surface.
   */
  semconvVersion?: typeof import('./semconv').SEMCONV_VERSION

  /**
   * Export strategy. If omitted, uses the globally registered OTel TracerProvider
   * (standard path for Node.js servers with `@opentelemetry/sdk-node`).
   *
   * For ephemeral runtimes (Lambda, Convex, Cloudflare Workers) where the full
   * OTel SDK isn't available, pass a URL or callback to export structured trace
   * events directly.
   */
  exporter?: UrlExporter | CallbackExporter

  /**
   * Baggage member keys allowed to cross a resumed run/segment boundary as
   * `crux.baggage.<key>` attributes on the resumed root span.
   *
   * Baggage is untrusted input carried on the propagation carrier — nothing
   * is copied by default. Applies to every first-party resume boundary
   * (Flow suspend/resume, Convex) since they all funnel through
   * `observe.resumeRun()`.
   */
  baggageAttributeAllowlist?: readonly string[]
}

// ─────────────────────────────────────────────────────────────────
// Plugin factory
// ─────────────────────────────────────────────────────────────────

/**
 * Create a telemetry plugin for Crux.
 *
 * Instruments all Crux operations with OpenTelemetry spans (standard path)
 * or lightweight structured traces (URL/callback exporter path).
 *
 * @param options - Telemetry configuration. All fields optional.
 * @returns A `CruxPlugin` to pass to `config({ plugins: [...] })`.
 *
 * @example
 * ```ts
 * import { config } from '@use-crux/core'
 * import { withTelemetry } from '@use-crux/otel'
 *
 * config({
 *   prompts,
 *   plugins: [withTelemetry({ serviceName: 'my-app' })],
 * })
 * ```
 */
export function withTelemetry(options?: TelemetryOptions): CruxPlugin {
  const opts = options ?? {}

  return {
    name: 'crux:otel',
    install(_hooks) {
      if (telemetryInstalled) {
        warnAboutDoubleInstall()
        return {
          dispose() {},
        }
      }

      telemetryInstalled = true
      const spanManager = createSpanManager(opts)
      const registry = createSpanRegistry(spanManager)
      const unsubscribe = subscribeObservability(createOtelRecordSubscriber(spanManager, opts, registry))

      const allowlist = opts.baggageAttributeAllowlist
      return {
        spanActivationHook: createSpanActivationHook(spanManager, registry),
        telemetryFlushHook: createTelemetryFlushHook(spanManager),
        ...(allowlist && allowlist.length > 0
          ? { telemetryResumeAttributesHook: (carrier: CruxPropagationCarrier) => baggageAttributesFromCarrier(carrier, allowlist) }
          : {}),
        dispose() {
          unsubscribe()
          telemetryInstalled = false
          return shutdownBoundToHostLifecycle(spanManager)
        },
      }
    },
  }
}

/**
 * Create the appropriate SpanManager based on the exporter option.
 *
 * - Callback exporter: lightweight span manager with callback exporter
 * - URL exporter: lightweight span manager with URL exporter
 * - No exporter: standard OTel tracer when `@opentelemetry/api` is available
 */
function createSpanManager(options: TelemetryOptions): SpanManager {
  let exporter: SpanExporter

  if (options.exporter) {
    if (typeof options.exporter === 'function') {
      exporter = createCallbackExporter(options.exporter)
    } else {
      exporter = createUrlExporter(options.exporter)
    }
    return createLightweightSpanManager(exporter)
  }

  return createOpenTelemetrySpanManager(options.serviceName) ??
    createLightweightSpanManager({
      export: () => {},
      shutdown: async () => {},
    })
}

/**
 * Create the `telemetryFlushHook` installed by `withTelemetry()`.
 *
 * Bridges `observe.flush()`/`observe.shutdown()` — and therefore every
 * existing host wrapper and explicit boundary flush — to this manager's own
 * `forceFlush`, for both the standard OTel path and the lightweight
 * exporter path. Never throws; a timeout or exporter failure reports
 * `{ ok: false }` instead.
 */
function createTelemetryFlushHook(spanManager: SpanManager) {
  return async (options: { deadlineMs?: number }): Promise<TelemetryFlushHookResult> => {
    try {
      const flushOptions: SpanManagerFlushOptions | undefined =
        options.deadlineMs === undefined ? undefined : { deadlineMs: options.deadlineMs }
      const result = await spanManager.forceFlush(flushOptions)
      return { ok: !result.timedOut, timedOut: result.timedOut }
    } catch {
      return { ok: false }
    }
  }
}

/**
 * Shut down `spanManager`, deferring or bounding the work to the active host
 * lifecycle when one is bound (e.g. via `observe.withHostLifecycle()` in a
 * Node/serverless/Workers/Convex wrapper).
 *
 * With a host deadline, `forceFlush` is bounded to the remaining budget before
 * teardown instead of the manager's own default flush window. With a `defer`
 * capability, the shutdown work is registered on the host's background-task
 * primitive (e.g. `waitUntil`) instead of blocking `dispose()` itself.
 */
function shutdownBoundToHostLifecycle(spanManager: SpanManager): void | Promise<void> {
  const lifecycle = activeHostLifecycle()
  const deadlineMs = remainingHostDeadlineMs(lifecycle)
  const shutdownPromise =
    deadlineMs === undefined
      ? spanManager.shutdown()
      : spanManager.forceFlush({ deadlineMs }).then(() => spanManager.shutdown())

  if (lifecycle?.defer) {
    lifecycle.defer(shutdownPromise)
    return
  }
  return shutdownPromise
}

function warnAboutDoubleInstall(): void {
  if (warnedAboutDoubleInstall) return
  warnedAboutDoubleInstall = true
  console.warn('[crux] @use-crux/otel telemetry is already installed; ignoring duplicate withTelemetry() install.')
}
