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
import {
  addDefinitionRefEvents,
  definitionRefProjection,
} from './definition-ref-mapper'
import {
  evidenceCoverageEventProjection,
  evidenceEventProjection,
} from './evidence-events'

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
 * Open run/span reference lookup shared between the record-mapper subscriber
 * and the span activation hook.
 *
 * The subscriber owns writes (spans are created/removed in response to graph
 * records); the activation hook only reads, resolving the same span the
 * subscriber already started for the current observability context so real
 * work runs with it active.
 */
export interface OtelSpanRegistry {
  readonly openRuns: ReturnType<typeof createBoundedRegistry<string, SpanRef>>
  readonly openSpans: ReturnType<typeof createBoundedRegistry<string, SpanRef>>
  /** Resolve the span to activate for a context: prefers the current span, falls back to the run root. */
  lookup(context: { readonly runId: string; readonly currentSpanId?: string }): SpanRef | undefined
}

/**
 * Create the shared open run/span registry backing one telemetry install.
 *
 * @param spanManager - Span lifecycle implementation; evicted entries are
 * force-ended through it so registry pressure never leaks span objects.
 */
export function createSpanRegistry(spanManager: SpanManager): OtelSpanRegistry {
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

  return {
    openRuns,
    openSpans,
    lookup(context) {
      return (context.currentSpanId ? openSpans.get(context.currentSpanId) : undefined) ?? openRuns.get(context.runId)
    },
  }
}

/**
 * Create a subscriber that maps canonical Crux graph records to OTel spans.
 *
 * The returned subscriber is synchronous and safe to install with
 * `subscribeObservability()`. It keeps only open span/run references and
 * ignores unmatched end records so duplicate or out-of-order end events do
 * not crash the subscriber.
 *
 * @param spanManager - Span lifecycle implementation used by the exporter.
 * @param options - Telemetry options whose custom attributes are attached to
 * every started span.
 * @param registry - Shared open run/span registry. Defaults to a fresh
 * registry when the caller does not need to share it with the span
 * activation hook (e.g. direct tests of the subscriber).
 * @returns A Crux observability subscriber.
 */
export function createOtelRecordSubscriber(
  spanManager: SpanManager,
  options: TelemetryOptions = {},
  registry: OtelSpanRegistry = createSpanRegistry(spanManager),
): CruxObservabilitySubscriber {
  const { openRuns, openSpans } = registry
  const recentlyEndedSpans = createTtlMap<string, RecentlyEndedSpan>({
    maxEntries: RECENTLY_ENDED_SPAN_MAX_ENTRIES,
    ttlMs: RECENTLY_ENDED_SPAN_TTL_MS,
  })

  return (record) => {
    switch (record.type) {
      case 'run:start': {
        const definitionRefs = definitionRefProjection(record.definitionRefs)
        const ref = spanManager.startSpan(
          record.name,
          {
            ...baseAttributes(options),
            'crux.run.id': record.runId,
            'crux.run.root_primitive': record.rootPrimitive,
            ...attributesFor(record.attributes),
            ...definitionRefs.attributes,
          },
          undefined,
          { traceId: record.traceId, deployment: record.deployment },
        )
        addDefinitionRefEvents(spanManager, ref, definitionRefs)
        openRuns.set(record.runId, ref)
        break
      }
      case 'run:end': {
        const ref = openRuns.delete(record.runId)
        if (!ref) break
        finishSpan(spanManager, ref, record)
        break
      }
      case 'run:suspend': {
        // A logical run does not hold one SDK span open across a physical
        // suspension boundary — end this segment's root span with a truthful
        // non-error status. `run:resume` (possibly in a fresh process) starts
        // a fresh root span sharing the same trace ID.
        const ref = openRuns.delete(record.runId)
        if (!ref) break
        spanManager.setAttributes(ref, {
          'crux.run.suspended': true,
          'crux.run.suspend_reason': record.reason,
        })
        spanManager.setStatus(ref, { code: 'OK' })
        spanManager.endSpan(ref)
        break
      }
      case 'run:resume': {
        // No live SDK span/context crosses the physical boundary. Segment
        // correlation is explicit: same trace ID plus a `previousSegmentId`
        // attribute, never a coerced Crux ID standing in for a W3C span ID.
        const ref = spanManager.startSpan(
          `run.resume ${record.reason}`,
          {
            ...baseAttributes(options),
            'crux.run.id': record.runId,
            'crux.run.resumed': true,
            'crux.run.resume_reason': record.reason,
            ...(record.previousSegmentId
              ? { 'crux.run.previous_segment_id': record.previousSegmentId }
              : {}),
            ...attributesFor(record.attributes),
          },
          undefined,
          { traceId: record.traceId, deployment: record.deployment },
        )
        openRuns.set(record.runId, ref)
        break
      }
      case 'span:start': {
        const definitionRefs = definitionRefProjection(record.definitionRefs)
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
            ...definitionRefs.attributes,
          },
          parent?.spanId,
          {
            spanId: record.spanId,
            traceId: record.traceId,
            deployment: record.deployment,
          },
        )
        addDefinitionRefEvents(spanManager, ref, definitionRefs)
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
        const definitionRefs = definitionRefProjection(record.definitionRefs)
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
            ...definitionRefs.attributes,
          },
          parent?.spanId,
          {
            spanId: record.spanId,
            traceId: record.traceId,
            deployment: record.deployment,
          },
        )
        addDefinitionRefEvents(spanManager, ref, definitionRefs)
        finishSpan(spanManager, ref, record)
        break
      }
      case 'span:event': {
        if (
          record.name === 'evidence.coverage' ||
          record.name === 'evidence.coverage.conflict'
        ) {
          const projection = evidenceCoverageEventProjection(record)
          if (!projection) break
          const target = spanEventTarget(
            openSpans,
            openRuns,
            recentlyEndedSpans,
            record,
          )
          if (!target) break
          spanManager.addEvent(
            target.ref,
            projection.name,
            projection.attributes,
          )
          break
        }
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
        if (isQualifiedEvidenceArtifact(record)) break
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
        if (record.edgeType === 'evidence.for') {
          const projection = evidenceEventProjection(record)
          if (!projection) break
          const ref = evidenceProducerTarget(
            openSpans,
            openRuns,
            recentlyEndedSpans,
            projection.producer,
          )
          if (!ref) break
          spanManager.addEvent(
            ref,
            projection.name,
            projection.attributes,
          )
          break
        }
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

function isQualifiedEvidenceArtifact(
  record: Extract<CruxGraphRecord, { type: 'artifact' }>,
): boolean {
  const attributes = record.attributes
  return (
    typeof attributes === 'object' &&
    attributes !== null &&
    (Object.prototype.hasOwnProperty.call(attributes, 'evidenceSource') ||
      Object.prototype.hasOwnProperty.call(attributes, 'approvalOccurrence'))
  )
}

function evidenceProducerTarget(
  spans: SpanRefLookup,
  runs: SpanRefLookup,
  recentlyEndedSpans: {
    get(spanId: string): RecentlyEndedSpan | undefined
  },
  producer: {
    readonly kind: 'run' | 'span'
    readonly id: string
  },
): SpanRef | undefined {
  if (producer.kind === 'run') return runs.get(producer.id)
  const active = spans.get(producer.id)
  if (active) return active
  const ended = recentlyEndedSpans.get(producer.id)
  return ended ? runs.get(ended.runId) : undefined
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
  if (
    operation === 'chat' ||
    operation === 'embeddings' ||
    operation === 'generate_image' ||
    operation === 'transcribe' ||
    operation === 'generate_speech' ||
    operation === 'generate_content'
  ) {
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
