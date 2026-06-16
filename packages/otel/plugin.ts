/**
 * Telemetry plugin for Crux.
 *
 * `withTelemetry()` returns a `CruxPlugin` that instruments all Crux
 * operations with OpenTelemetry spans or lightweight structured traces.
 *
 * @module
 */

import type { CruxPlugin } from '@crux/core'
import type { TraceSpan } from './types'
import { createCallbackExporter, createUrlExporter, type SpanExporter } from './exporter'
import { createLightweightSpanManager, type SpanManager } from './span-manager'
import { createOtelMiddleware } from './middleware'
import { createOtelInstrumentationHooks } from './hooks'

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
   * @default '@crux/otel'
   */
  serviceName?: string

  /**
   * Whether to record prompt/input content as span attributes.
   * Disable in production to avoid logging sensitive data.
   * @default false
   */
  recordContent?: boolean

  /** Custom attributes added to every span. */
  attributes?: Record<string, string>

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
 * import { config } from '@crux/core'
 * import { withTelemetry } from '@crux/otel'
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
      const spanManager = createSpanManager(opts)
      const middleware = createOtelMiddleware(spanManager, opts)
      const instrumentationHooks = createOtelInstrumentationHooks(spanManager, opts)

      return {
        middleware,
        instrumentationHooks,
        dispose() {
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
 * - No exporter: lightweight span manager with no-op exporter (OTel path TBD)
 */
function createSpanManager(options: TelemetryOptions): SpanManager {
  let exporter: SpanExporter

  if (options.exporter) {
    if (typeof options.exporter === 'function') {
      exporter = createCallbackExporter(options.exporter)
    } else {
      exporter = createUrlExporter(options.exporter)
    }
  } else {
    // No exporter configured — for now, use a no-op exporter.
    // OTel TracerProvider integration will be added when needed.
    exporter = {
      export: () => {},
      shutdown: async () => {},
    }
  }

  return createLightweightSpanManager(exporter)
}
