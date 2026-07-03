/**
 * OTel subscriber for the canonical Crux observability graph stream.
 *
 * The mapper is intentionally downstream of `observe.*`: graph records remain
 * the single event spine, while this module projects those records into spans
 * for the lightweight exporter path and future OTel SDK integrations.
 *
 * @module
 */

import type { CruxGraphRecord, CruxPrimitiveName } from '@use-crux/core/observability'
import type { CruxObservabilitySubscriber } from '@use-crux/core/observability'
import type { SpanManager, SpanRef } from './span-manager'
import type { TelemetryOptions } from './plugin'
import { CRUX_TOOL_NAME, GEN_AI_REQUEST_MODEL, GEN_AI_SYSTEM } from './attributes'
import { attributesFor, metricsFor, type OtelAttributes } from './attribute-mapper'
import { createBoundedRegistry } from './bounded-registry'
import { createTtlMap } from './ttl-map'

const RECENTLY_ENDED_SPAN_TTL_MS = 30_000
const RECENTLY_ENDED_SPAN_MAX_ENTRIES = 1_000
const OPEN_REGISTRY_MAX_ENTRIES = 10_000
const OPEN_REGISTRY_MAX_AGE_MS = 10 * 60_000

const primitiveSpanNames = {
  run: 'crux.run',
  'generation.call': 'crux.generate',
  'generation.stream': 'crux.stream',
  'prompt.resolve': 'crux.prompt.resolve',
  'prompt.budget': 'crux.prompt.budget',
  'context.resolve': 'crux.context.resolve',
  'context.predicate': 'crux.context.predicate',
  'context.cache': 'crux.context.cache',
  'agent.run': 'crux.agent.run',
  'flow.run': 'crux.flow',
  'flow.step': 'crux.flow.step',
  'flow.suspension': 'crux.flow.suspension',
  'composition.parallel': 'crux.composition.parallel',
  'composition.pipeline': 'crux.composition.pipeline',
  'composition.consensus': 'crux.composition.consensus',
  'composition.swarm': 'crux.composition.swarm',
  'composition.branch': 'crux.composition.branch',
  'composition.join': 'crux.composition.join',
  'composition.vote': 'crux.composition.vote',
  'tool.call': 'crux.tool.call',
  'tool.approval': 'crux.tool.approval',
  'retrieval.pipeline': 'crux.retrieval.pipeline',
  'embedding.call': 'crux.embedding',
  'retrieval.query': 'crux.retrieval',
  'retrieval.stage': 'crux.retrieval.stage',
  'memory.read': 'crux.memory.read',
  'memory.write': 'crux.memory.write',
  'constraint.check': 'crux.constraint.check',
  'constraint.retry': 'crux.constraint.retry',
  'guardrail.run': 'crux.guardrail.run',
  'routing.router': 'crux.router.select',
  'routing.cascade': 'crux.cascade.run',
  'fallback.attempt': 'crux.fallback.attempt',
  'cache.lookup': 'crux.cache.lookup',
  'compaction.run': 'crux.compact',
  'eval.run': 'crux.eval.run',
  'eval.case': 'crux.eval.case',
  'scoring.judge': 'crux.judge',
  'citation.check': 'crux.citation.check',
  'handoff.prepare': 'crux.handoff.prepare',
  'delegate.invoke': 'crux.delegate',
  'plan.operation': 'crux.plan.operation',
  'task.operation': 'crux.task.operation',
  'workspace.operation': 'crux.workspace',
  'indexing.pipeline': 'crux.indexing',
  'ingest.parse': 'crux.ingest.parse',
  'corpus.sync': 'crux.corpus.sync',
  'skill.load': 'crux.skill.load',
  'security.warning': 'crux.security.warning',
  'cost.record': 'crux.cost.record',
  'feedback.record': 'crux.feedback.record',
  'runtime.convex.action': 'crux.runtime.convex.action',
  'runtime.convex.query': 'crux.runtime.convex.query',
  'runtime.convex.mutation': 'crux.runtime.convex.mutation',
  'runtime.convex.schedule': 'crux.runtime.convex.schedule',
  'runtime.convex.resume': 'crux.runtime.convex.resume',
  'runtime.convex.flush': 'crux.runtime.convex.flush',
  'custom.operation': 'crux.custom.operation',
} satisfies Record<CruxPrimitiveName, string>

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
  const recentlyEndedSpans = createTtlMap<string, SpanRef>({
    maxEntries: RECENTLY_ENDED_SPAN_MAX_ENTRIES,
    ttlMs: RECENTLY_ENDED_SPAN_TTL_MS,
  })

  return (record) => {
    switch (record.type) {
      case 'run:start': {
        const ref = spanManager.startSpan(record.name, {
          ...baseAttributes(options),
          'crux.run.id': record.runId,
          'crux.run.root_primitive': record.rootPrimitive,
          ...attributesFor(record.attributes),
        }, undefined, { traceId: record.traceId })
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
        const parent = (record.parentSpanId ? openSpans.get(record.parentSpanId) : undefined) ?? openRuns.get(record.runId)
        const ref = spanManager.startSpan(nameForSpan(record), {
          ...baseAttributes(options),
          'crux.run.id': record.runId,
          'crux.span.id': record.spanId,
          'crux.primitive.family': record.family,
          'crux.primitive.name': record.primitive,
          ...(record.provider ? { [GEN_AI_SYSTEM]: record.provider } : {}),
          ...(record.model ? { [GEN_AI_REQUEST_MODEL]: record.model } : {}),
          ...(record.promptId ? { 'crux.prompt.id': record.promptId } : {}),
          ...(record.toolName ? { [CRUX_TOOL_NAME]: record.toolName } : {}),
          ...attributesFor(record.attributes),
        }, parent?.spanId, { spanId: record.spanId, traceId: record.traceId })
        openSpans.set(record.spanId, ref)
        break
      }
      case 'span:end': {
        const ref = openSpans.delete(record.spanId)
        if (!ref) break
        recentlyEndedSpans.set(record.spanId, ref)
        finishSpan(spanManager, ref, record)
        break
      }
      case 'span': {
        const parent = (record.parentSpanId ? openSpans.get(record.parentSpanId) : undefined) ?? openRuns.get(record.runId)
        const ref = spanManager.startSpan(nameForSpan(record), {
          ...baseAttributes(options),
          'crux.run.id': record.runId,
          'crux.span.id': record.spanId,
          'crux.primitive.family': record.family,
          'crux.primitive.name': record.primitive,
          ...attributesFor(record.attributes),
        }, parent?.spanId, { spanId: record.spanId, traceId: record.traceId })
        finishSpan(spanManager, ref, record)
        break
      }
      case 'span:event': {
        const ref = openSpans.get(record.spanId) ?? recentlyEndedSpans.get(record.spanId)
        if (!ref) break
        spanManager.addEvent(ref, record.name, attributesFor(record.attributes))
        break
      }
      case 'artifact': {
        const ref = record.spanId ? openSpans.get(record.spanId) ?? recentlyEndedSpans.get(record.spanId) : undefined
        if (!ref) break
        spanManager.addEvent(ref, 'crux.artifact', {
          'crux.artifact.kind': record.kind,
          'crux.artifact.encoding': record.encoding,
          ...(record.contentType ? { 'crux.artifact.content_type': record.contentType } : {}),
          ...(record.sizeBytes != null ? { 'crux.artifact.size_bytes': record.sizeBytes } : {}),
          ...attributesFor(record.attributes),
        })
        break
      }
      case 'edge': {
        const ref = spanRefForNode(openSpans, openRuns, record.to) ?? spanRefForNode(openSpans, openRuns, record.from)
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

function nameForSpan(record: Extract<CruxGraphRecord, { type: 'span:start' | 'span' }>): string {
  if (record.primitive === 'tool.call') {
    const toolName =
      stringValue(record.attributes?.toolName) ??
      ('toolName' in record ? stringValue(record.toolName) : undefined) ??
      record.name
    return `crux.tool.${toolName}`
  }
  if (record.primitive === 'tool.approval') return 'crux.tool.approval'
  return primitiveSpanNames[record.primitive]
}

function finishSpan(
  spanManager: SpanManager,
  ref: SpanRef,
  record: Extract<CruxGraphRecord, { type: 'run:end' | 'span:end' | 'span' }>,
): void {
  const attributes = {
    ...(record.durationMs != null ? { 'crux.duration_ms': record.durationMs } : {}),
    ...metricsFor(record.metrics),
    ...attributesFor(record.attributes),
  }
  if (Object.keys(attributes).length > 0) {
    spanManager.setAttributes(ref, attributes)
  }
  if (record.error) {
    spanManager.recordError(ref, record.error.message)
  } else if (record.status === 'error' || record.status === 'blocked' || record.status === 'cancelled') {
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
