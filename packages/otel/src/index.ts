/**
 * `@use-crux/otel` — OpenTelemetry integration for Crux.
 *
 * Emits OTel spans for all instrumented Crux events (generate, stream,
 * tools, flows, compositions, memory, etc.).
 *
 * Supports two export paths:
 * - **Standard OTel**: Uses the globally registered TracerProvider (for Node.js servers)
 * - **Lightweight**: HTTP POST or callback exporter (for Lambda, Convex, Cloudflare)
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
 *
 * @module
 */

export { withTelemetry } from './plugin'
export type { TelemetryOptions, UrlExporter, CallbackExporter } from './plugin'
export type { TraceSpan, SpanStatus } from './types'
export { createUrlExporter, createCallbackExporter } from './exporter'
export type { SpanExporter } from './exporter'
export { createCruxResourceAttributes } from './resource-attributes'
export type { CruxOtelResourceAttributes } from './resource-attributes'
export { createOtelRecordSubscriber, createSpanRegistry } from './record-mapper'
export type { OtelSpanRegistry } from './record-mapper'
export * from './attributes'
export {
  injectCruxPropagationCarrier,
  extractCruxPropagationCarrier,
  baggageAttributesFromCarrier,
} from './propagation'
export type { ExtractCruxPropagationCarrierOptions, ExtractedCruxPropagationCarrier } from './propagation'
