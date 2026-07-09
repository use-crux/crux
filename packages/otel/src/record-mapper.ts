/**
 * OTel subscriber for the canonical Crux observability graph stream.
 *
 * The mapper is intentionally downstream of `observe.*`: graph records remain
 * the single event spine, while this module projects those records into spans
 * for the lightweight exporter path and future OTel SDK integrations.
 *
 * @module
 */

import type { CruxGraphRecord } from '@use-crux/core/observability'
import type { CruxObservabilitySubscriber } from '@use-crux/core/observability'
import type { SpanManager, SpanRef } from './span-manager'
import type { TelemetryOptions } from './plugin'
import { CRUX_TOOL_NAME } from './attributes'
import {
  attributesFor,
  metricsFor,
  type OtelAttributes,
} from './attribute-mapper'
import { createBoundedRegistry } from './bounded-registry'
import {
  GEN_AI_OPERATION_NAME,
  GEN_AI_PROVIDER_NAME,
  GEN_AI_REQUEST_MODEL,
  genAiOperationName,
  primitiveSpanNames,
} from './semconv'
import { messageContentAttributesForArtifact } from './message-content'
import { createTtlMap } from './ttl-map'

const RECENTLY_ENDED_SPAN_TTL_MS = 30_000
const RECENTLY_ENDED_SPAN_MAX_ENTRIES = 1_000
const OPEN_REGISTRY_MAX_ENTRIES = 10_000
const OPEN_REGISTRY_MAX_AGE_MS = 10 * 60_000

interface RecentlyEndedSpan {
  readonly ref: SpanRef
  readonly runId: string
}

interface SpanEventTarget {
  readonly ref: SpanRef
  readonly lateSpanId?: string
}

/**
 * Create a subscriber that maps canonical Crux graph records to OTel spans.
 *
 * The returned subscriber is synchronous and safe to install with
 * `subscribeObservability()`. It keeps only open span/run references and
 * ignores unmatched end records, matching the old hook path's no-crash
 * behavior for duplicate or out-of-order end events.
 *
 * @param spanManager - Span lifecycle implementation used by the exporter.
 * @param options - Telemetry options whose custom attributes are attached to
 * every started span.
 * @returns A Crux observability subscriber.
 */
export function createOtelRecordSubscriber(
  spanManager: SpanManager,
  options: TelemetryOptions = {},
): CruxObservabilitySubscriber {
  const openRuns = createBoundedRegistry<string, SpanRef>({
    maxEntries: OPEN_REGISTRY_MAX_ENTRIES,
    maxAgeMs: OPEN_REGISTRY_MAX_AGE_MS,
    onEvict: (_runId, ref) => {
      spanManager.expireSpan(ref)
    },
  })
  const openSpans = createBoundedRegistry<string, SpanRef>({
    maxEntries: OPEN_REGISTRY_MAX_ENTRIES,
    maxAgeMs: OPEN_REGISTRY_MAX_AGE_MS,
    onEvict: (_spanId, ref) => {
      spanManager.expireSpan(ref)
    },
  })
  const recentlyEndedSpans = createTtlMap<string, RecentlyEndedSpan>({
    maxEntries: RECENTLY_ENDED_SPAN_MAX_ENTRIES,
    ttlMs: RECENTLY_ENDED_SPAN_TTL_MS,
  })

  return (record) => {
    switch (record.type) {
      case 'run:start': {
        const ref = spanManager.startSpan(
          record.name,
          {
            ...baseAttributes(options),
            'crux.run.id': record.runId,
            'crux.run.root_primitive': record.rootPrimitive,
            ...attributesFor(record.attributes),
          },
          undefined,
          { traceId: record.traceId },
        )
        openRuns.set(record.runId, ref)
        break
      }
      case 'run:end': {
        const ref = openRuns.delete(record.runId)
        if (!ref) break
        finishSpan(spanManager, ref, record)
        break
      }
      case 'span:start': {
        const parent =
          (record.parentSpanId
            ? openSpans.get(record.parentSpanId)
            : undefined) ?? openRuns.get(record.runId)
        const ref = spanManager.startSpan(
          nameForSpan(record),
          {
            ...baseAttributes(options),
            'crux.run.id': record.runId,
            'crux.span.id': record.spanId,
            'crux.primitive.family': record.family,
            'crux.primitive.name': record.primitive,
            ...operationAttributes(record),
            ...(record.provider
              ? { [GEN_AI_PROVIDER_NAME]: record.provider }
              : {}),
            ...(record.model ? { [GEN_AI_REQUEST_MODEL]: record.model } : {}),
            ...(record.promptId ? { 'crux.prompt.id': record.promptId } : {}),
            ...(record.toolName ? { [CRUX_TOOL_NAME]: record.toolName } : {}),
            ...attributesFor(record.attributes),
          },
          parent?.spanId,
          { spanId: record.spanId, traceId: record.traceId },
        )
        openSpans.set(record.spanId, ref)
        break
      }
      case 'span:end': {
        const ref = openSpans.delete(record.spanId)
        if (!ref) break
        recentlyEndedSpans.set(record.spanId, { ref, runId: record.runId })
        finishSpan(spanManager, ref, record)
        break
      }
      case 'span': {
        const parent =
          (record.parentSpanId
            ? openSpans.get(record.parentSpanId)
            : undefined) ?? openRuns.get(record.runId)
        const ref = spanManager.startSpan(
          nameForSpan(record),
          {
            ...baseAttributes(options),
            'crux.run.id': record.runId,
            'crux.span.id': record.spanId,
            'crux.primitive.family': record.family,
            'crux.primitive.name': record.primitive,
            ...operationAttributes(record),
            ...attributesFor(record.attributes),
          },
          parent?.spanId,
          { spanId: record.spanId, traceId: record.traceId },
        )
        finishSpan(spanManager, ref, record)
        break
      }
      case 'span:event': {
        const target = spanEventTarget(
          openSpans,
          openRuns,
          recentlyEndedSpans,
          record,
        )
        if (!target) break
        spanManager.addEvent(
          target.ref,
          record.name,
          lateRecordAttributes(
            target.lateSpanId,
            attributesFor(record.attributes),
          ),
        )
        break
      }
      case 'artifact': {
        const target = artifactEventTarget(
          openSpans,
          openRuns,
          recentlyEndedSpans,
          record,
        )
        if (!target) break
        spanManager.addEvent(target.ref, 'crux.artifact', {
          ...lateRecordAttributes(target.lateSpanId),
          'crux.artifact.kind': record.kind,
          'crux.artifact.encoding': record.encoding,
          ...(record.contentType
            ? { 'crux.artifact.content_type': record.contentType }
            : {}),
          ...(record.sizeBytes != null
            ? { 'crux.artifact.size_bytes': record.sizeBytes }
            : {}),
          ...attributesFor(record.attributes),
        })
        const messageAttributes = messageContentAttributesForArtifact(
          record,
          options,
        )
        if (Object.keys(messageAttributes).length > 0) {
          spanManager.setAttributes(target.ref, messageAttributes)
        }
        break
      }
      case 'edge': {
        const ref =
          spanRefForNode(openSpans, openRuns, record.to) ??
          spanRefForNode(openSpans, openRuns, record.from)
        if (!ref) break
        spanManager.addEvent(ref, 'crux.edge', {
          'crux.edge.type': record.edgeType,
          'crux.edge.from': `${record.from.kind}:${record.from.id}`,
          'crux.edge.to': `${record.to.kind}:${record.to.id}`,
          ...attributesFor(record.attributes),
        })
        break
      }
      default:
        assertNever(record)
    }
  }
}

function spanEventTarget(
  spans: SpanRefLookup,
  runs: SpanRefLookup,
  recentlyEndedSpans: { get(spanId: string): RecentlyEndedSpan | undefined },
  record: Extract<CruxGraphRecord, { type: 'span:event' }>,
): SpanEventTarget | undefined {
  const active = spans.get(record.spanId)
  if (active) return { ref: active }
  return lateRecordRunTarget(runs, recentlyEndedSpans, record)
}

function artifactEventTarget(
  spans: SpanRefLookup,
  runs: SpanRefLookup,
  recentlyEndedSpans: { get(spanId: string): RecentlyEndedSpan | undefined },
  record: Extract<CruxGraphRecord, { type: 'artifact' }>,
): SpanEventTarget | undefined {
  if (!record.spanId) return undefined
  const active = spans.get(record.spanId)
  if (active) return { ref: active }
  return lateRecordRunTarget(runs, recentlyEndedSpans, record)
}

function lateRecordRunTarget(
  runs: SpanRefLookup,
  recentlyEndedSpans: { get(spanId: string): RecentlyEndedSpan | undefined },
  record: Extract<CruxGraphRecord, { type: 'span:event' | 'artifact' }>,
): SpanEventTarget | undefined {
  if (!record.spanId) return undefined
  const marker = recentlyEndedSpans.get(record.spanId)
  if (!marker) return undefined
  const runRef = runs.get(marker.runId)
  return runRef ? { ref: runRef, lateSpanId: record.spanId } : undefined
}

function lateRecordAttributes(
  originalSpanId: string | undefined,
  attributes: OtelAttributes = {},
): OtelAttributes {
  if (!originalSpanId) return attributes
  return { ...attributes, 'crux.late_for_span': originalSpanId }
}

function nameForSpan(
  record: Extract<CruxGraphRecord, { type: 'span:start' | 'span' }>,
): string {
  const operation = genAiOperationName(record.primitive)
  if (operation) return `${operation} ${spanNameSubject(record, operation)}`
  return primitiveSpanNames[record.primitive]
}

function operationAttributes(
  record: Extract<CruxGraphRecord, { type: 'span:start' | 'span' }>,
): OtelAttributes {
  const operation = genAiOperationName(record.primitive)
  return operation ? { [GEN_AI_OPERATION_NAME]: operation } : {}
}

function spanNameSubject(
  record: Extract<CruxGraphRecord, { type: 'span:start' | 'span' }>,
  operation: NonNullable<ReturnType<typeof genAiOperationName>>,
): string {
  if (operation === 'chat' || operation === 'embeddings') {
    return (
      stringValue('model' in record ? record.model : undefined) ??
      stringValue(record.attributes?.model) ??
      record.name
    )
  }
  if (operation === 'execute_tool') {
    return (
      stringValue(record.attributes?.toolName) ??
      ('toolName' in record ? stringValue(record.toolName) : undefined) ??
      record.name
    )
  }
  return record.name
}

function finishSpan(
  spanManager: SpanManager,
  ref: SpanRef,
  record: Extract<CruxGraphRecord, { type: 'run:end' | 'span:end' | 'span' }>,
): void {
  const attributes = {
    ...(record.durationMs != null
      ? { 'crux.duration_ms': record.durationMs }
      : {}),
    ...metricsFor(record.metrics),
    ...attributesFor(record.attributes),
  }
  if (Object.keys(attributes).length > 0) {
    spanManager.setAttributes(ref, attributes)
  }
  if (record.error) {
    spanManager.recordError(ref, record.error.message)
  } else if (
    record.status === 'error' ||
    record.status === 'blocked' ||
    record.status === 'cancelled'
  ) {
    spanManager.setStatus(ref, { code: 'ERROR', message: record.status })
  }
  spanManager.endSpan(ref)
}

function baseAttributes(options: TelemetryOptions): OtelAttributes {
  return options.attributes ? { ...options.attributes } : {}
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function spanRefForNode(
  spans: SpanRefLookup,
  runs: SpanRefLookup,
  node: Extract<CruxGraphRecord, { type: 'edge' }>['from'],
): SpanRef | undefined {
  if (node.kind === 'span') return spans.get(node.id)
  if (node.kind === 'run') return runs.get(node.id)
  return undefined
}

interface SpanRefLookup {
  get(key: string): SpanRef | undefined
}

function assertNever(value: never): never {
  throw new Error(`Unexpected observability record: ${String(value)}`)
}
