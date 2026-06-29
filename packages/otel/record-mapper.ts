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
import {
  CRUX_COST,
  CRUX_PROMPT_ID,
  CRUX_TOOL_CALL_ID,
  CRUX_TOOL_MODEL_OUTPUT_SIZE,
  CRUX_TOOL_MODEL_OUTPUT_TYPE,
  CRUX_TOOL_NAME,
  CRUX_TOOL_OUTPUT_SIZE,
  CRUX_TOOL_TOKEN_SAVINGS_ESTIMATE,
  GEN_AI_CLIENT_DURATION_MS,
  GEN_AI_CLIENT_OUTPUT_TOKENS_PER_SECOND,
  GEN_AI_CLIENT_TIME_PER_OUTPUT_CHUNK_MS,
  GEN_AI_CLIENT_TIME_TO_FIRST_TOKEN_MS,
  GEN_AI_REQUEST_MODEL,
  GEN_AI_RESPONSE_FINISH_REASONS,
  GEN_AI_RESPONSE_MODEL,
  GEN_AI_SYSTEM,
  GEN_AI_USAGE_INPUT_TOKENS,
  GEN_AI_USAGE_OUTPUT_TOKENS,
} from './attributes'

type OtelAttributeValue = string | number | boolean
type OtelAttributes = Record<string, OtelAttributeValue>

const primitiveSpanNames: Partial<Record<CruxPrimitiveName, string>> = {
  'generation.call': 'crux.generate',
  'generation.stream': 'crux.stream',
  'flow.run': 'crux.flow',
  'flow.step': 'crux.flow.step',
  'embedding.call': 'crux.embedding',
  'retrieval.query': 'crux.retrieval',
  'retrieval.stage': 'crux.retrieval.stage',
  'retrieval.pipeline': 'crux.retrieval.pipeline',
  'memory.read': 'crux.memory.read',
  'memory.write': 'crux.memory.write',
  'compaction.run': 'crux.compact',
  'scoring.judge': 'crux.judge',
  'delegate.invoke': 'crux.delegate',
  'workspace.operation': 'crux.workspace',
  'indexing.pipeline': 'crux.indexing',
  'ingest.parse': 'crux.ingest.parse',
  'corpus.sync': 'crux.corpus.sync',
  'cost.record': 'crux.cost.record',
  'routing.router': 'crux.router.select',
  'routing.cascade': 'crux.cascade.run',
  'constraint.check': 'crux.constraint.check',
  'constraint.retry': 'crux.constraint.retry',
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
  const openRuns = new Map<string, SpanRef>()
  const openSpans = new Map<string, SpanRef>()

  return (record) => {
    switch (record.type) {
      case 'run:start': {
        const ref = spanManager.startSpan(record.name, {
          ...baseAttributes(options),
          'crux.run.id': record.runId,
          'crux.run.root_primitive': record.rootPrimitive,
          ...attributesFor(record.attributes),
        })
        openRuns.set(record.runId, ref)
        break
      }
      case 'run:end': {
        const ref = openRuns.get(record.runId)
        if (!ref) break
        openRuns.delete(record.runId)
        finishSpan(spanManager, ref, record)
        break
      }
      case 'span:start': {
        const parent = record.parentSpanId ? openSpans.get(record.parentSpanId) : openRuns.get(record.runId)
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
        }, parent?.spanId)
        openSpans.set(record.spanId, ref)
        break
      }
      case 'span:end': {
        const ref = openSpans.get(record.spanId)
        if (!ref) break
        openSpans.delete(record.spanId)
        finishSpan(spanManager, ref, record)
        break
      }
      case 'span': {
        const parent = record.parentSpanId ? openSpans.get(record.parentSpanId) : openRuns.get(record.runId)
        const ref = spanManager.startSpan(nameForSpan(record), {
          ...baseAttributes(options),
          'crux.run.id': record.runId,
          'crux.span.id': record.spanId,
          'crux.primitive.family': record.family,
          'crux.primitive.name': record.primitive,
          ...attributesFor(record.attributes),
        }, parent?.spanId)
        finishSpan(spanManager, ref, record)
        break
      }
      case 'span:event': {
        const ref = openSpans.get(record.spanId)
        if (!ref) break
        spanManager.addEvent(ref, record.name, attributesFor(record.attributes))
        break
      }
      case 'artifact': {
        const ref = record.spanId ? openSpans.get(record.spanId) : undefined
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
  return primitiveSpanNames[record.primitive] ?? `crux.${record.primitive}`
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

function metricsFor(metrics: Extract<CruxGraphRecord, { type: 'run:end' | 'span:end' | 'span' }>['metrics']): OtelAttributes {
  if (!metrics) return {}
  return attributesFor({
    inputTokens: metrics.inputTokens,
    outputTokens: metrics.outputTokens,
    totalTokens: metrics.totalTokens,
    costUsd: metrics.costUsd,
    ttftMs: metrics.ttftMs,
    tokensPerSecond: metrics.tokensPerSecond,
    ...metrics,
  })
}

function attributesFor(attributes: Record<string, unknown> | undefined): OtelAttributes {
  if (!attributes) return {}
  const result: OtelAttributes = {}
  for (const [key, value] of Object.entries(attributes)) {
    const normalizedKey = attributeKeyFor(key)
    const normalizedValue = attributeValue(value)
    if (normalizedValue !== undefined) {
      result[normalizedKey] = normalizedValue
    }
  }
  return result
}

function attributeKeyFor(key: string): string {
  switch (key) {
    case 'provider':
      return GEN_AI_SYSTEM
    case 'model':
      return GEN_AI_REQUEST_MODEL
    case 'actualModelId':
      return GEN_AI_RESPONSE_MODEL
    case 'finishReason':
      return GEN_AI_RESPONSE_FINISH_REASONS
    case 'gen.duration_ms':
      return GEN_AI_CLIENT_DURATION_MS
    case 'gen.time_to_first_token_ms':
      return GEN_AI_CLIENT_TIME_TO_FIRST_TOKEN_MS
    case 'gen.output_tokens_per_second':
      return GEN_AI_CLIENT_OUTPUT_TOKENS_PER_SECOND
    case 'gen.time_per_output_chunk_ms':
      return GEN_AI_CLIENT_TIME_PER_OUTPUT_CHUNK_MS
    case 'inputTokens':
      return GEN_AI_USAGE_INPUT_TOKENS
    case 'outputTokens':
      return GEN_AI_USAGE_OUTPUT_TOKENS
    case 'costUsd':
      return CRUX_COST
    case 'promptId':
      return CRUX_PROMPT_ID
    case 'toolName':
      return CRUX_TOOL_NAME
    case 'toolCallId':
      return CRUX_TOOL_CALL_ID
    case 'modelOutputType':
      return CRUX_TOOL_MODEL_OUTPUT_TYPE
    case 'outputSize':
      return CRUX_TOOL_OUTPUT_SIZE
    case 'modelOutputSize':
      return CRUX_TOOL_MODEL_OUTPUT_SIZE
    case 'tokenSavingsEstimate':
      return CRUX_TOOL_TOKEN_SAVINGS_ESTIMATE
    default:
      return key.includes('.') ? key : `crux.${key}`
  }
}

function attributeValue(value: unknown): OtelAttributeValue | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function spanRefForNode(
  spans: ReadonlyMap<string, SpanRef>,
  runs: ReadonlyMap<string, SpanRef>,
  node: Extract<CruxGraphRecord, { type: 'edge' }>['from'],
): SpanRef | undefined {
  if (node.kind === 'span') return spans.get(node.id)
  if (node.kind === 'run') return runs.get(node.id)
  return undefined
}
