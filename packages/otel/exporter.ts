/**
 * Lightweight span exporters for ephemeral runtimes.
 *
 * These exporters handle `TraceSpan` objects directly, without requiring
 * the full OTel SDK. Used when `withTelemetry({ exporter: ... })` is configured.
 *
 * @module
 */

import type { TraceSpan } from './types'

/** A span exporter that accepts completed spans. */
export interface SpanExporter {
  /** Export a batch of completed spans. */
  export(spans: ReadonlyArray<TraceSpan>): void | Promise<void>
  /** Flush any buffered spans and shut down. */
  shutdown(): Promise<void>
}

/** URL-based exporter configuration. */
export interface UrlExporterOptions {
  /** Endpoint to POST span batches to. */
  url: string
  /** Optional headers (e.g., API keys). */
  headers?: Record<string, string>
}

/**
 * Create an exporter that POSTs span batches to a URL.
 *
 * Fire-and-forget with 5s timeout — failures are silently ignored
 * so telemetry never impacts application behavior.
 *
 * @param options - URL and optional headers.
 * @returns A `SpanExporter` that sends spans via HTTP POST.
 */
export function createUrlExporter(options: UrlExporterOptions): SpanExporter {
  let closed = false

  return {
    async export(spans) {
      if (closed || spans.length === 0) return
      try {
        await fetch(options.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...options.headers,
          },
          body: JSON.stringify(spans),
          signal: AbortSignal.timeout(5000),
        })
      } catch {
        // Silently ignore — telemetry never breaks the app
      }
    },
    async shutdown() {
      closed = true
    },
  }
}

/**
 * Create an exporter that calls a user-provided callback with span batches.
 *
 * @param callback - Function to receive completed spans.
 * @returns A `SpanExporter` that delegates to the callback.
 */
export function createCallbackExporter(
  callback: (spans: ReadonlyArray<TraceSpan>) => void | Promise<void>,
): SpanExporter {
  let closed = false

  return {
    async export(spans) {
      if (closed || spans.length === 0) return
      try {
        await callback(spans)
      } catch {
        // Silently ignore
      }
    },
    async shutdown() {
      closed = true
    },
  }
}
