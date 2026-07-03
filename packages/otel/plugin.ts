/**
 * Telemetry plugin for Crux.
 *
 * `withTelemetry()` returns a `CruxPlugin` that instruments all Crux
 * operations with OpenTelemetry spans or lightweight structured traces.
 *
 * @module
 */

import type { CruxPlugin } from '@use-crux/core'
import { subscribeObservability } from '@use-crux/core/observability'
import type { TraceSpan } from './types'
import { createCallbackExporter, createUrlExporter, type SpanExporter } from './exporter'
import { createLightweightSpanManager, type SpanManager } from './span-manager'
import { createOpenTelemetrySpanManager } from './otel-span-manager'
import { createOtelRecordSubscriber } from './record-mapper'

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
    install(runtime) {
      if (telemetryInstalled) {
        warnAboutDoubleInstall()
        return {
          dispose() {},
        }
      }

      telemetryInstalled = true
      const spanManager = createSpanManager(opts)
      const unsubscribe = subscribeObservability(createOtelRecordSubscriber(spanManager, opts))

      return {
        dispose() {
          unsubscribe()
          telemetryInstalled = false
          spanManager.shutdown()
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

function warnAboutDoubleInstall(): void {
  if (warnedAboutDoubleInstall) return
  warnedAboutDoubleInstall = true
  console.warn('[crux] @use-crux/otel telemetry is already installed; ignoring duplicate withTelemetry() install.')
}
