/**
 * Structured span types for the lightweight exporter path.
 *
 * When users provide a URL or callback exporter (for ephemeral runtimes
 * like Convex/Lambda), spans are tracked as `TraceSpan` objects instead
 * of OTel SDK spans.
 *
 * @module
 */

/** Span status matching OTel conventions. */
export interface SpanStatus {
  code: 'OK' | 'ERROR' | 'UNSET'
  message?: string
}

/**
 * Structured span data for the lightweight exporter.
 *
 * Mirrors the essential fields of an OTel Span but without the OTel SDK dependency.
 * Exported via URL POST or callback when users configure a custom exporter.
 */
export interface TraceSpan {
  /** Unique span identifier. */
  spanId: string
  /** Parent span ID for nesting. */
  parentSpanId?: string
  /** Trace ID grouping related spans. */
  traceId: string
  /** Human-readable span name (e.g., 'crux.generate', 'crux.tool.webSearch'). */
  name: string
  /** Span start time (Unix ms). */
  startTime: number
  /** Span end time (Unix ms). */
  endTime: number
  /** Duration in milliseconds. */
  durationMs: number
  /** Key-value attributes. */
  attributes: Record<string, string | number | boolean>
  /** Span status. */
  status: SpanStatus
  /** Span events (for point-in-time occurrences like budget checks). */
  events?: Array<{
    name: string
    time: number
    attributes?: Record<string, string | number | boolean>
  }>
}
