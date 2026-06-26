/**
 * Trace-backed signal capture for the Quality engine.
 *
 * Signals come from the observability span model, never from output-shape
 * guessing (direction doc §5.1): the engine tees the configured observability
 * transport, runs every cell inside its own observed run, and extracts typed
 * per-cell signals from the records that carry the cell's `runId`. This is
 * also what links every Experiment cell to its devtools trace run.
 *
 * @internal Not exported from `@use-crux/core/quality` — engine plumbing only.
 * @module
 */

import type {
  CruxArtifactRecord,
  CruxCitationReportPreview,
  CruxConstraintReportPreview,
  CruxGraphRecord,
  CruxGuardrailReportPreview,
  CruxHandoffPayloadPreview,
  CruxMemoryDiffPreview,
  CruxMemoryRecallPreview,
  CruxMetrics,
  CruxRetrievalHitsPreview,
  CruxRoutingReportPreview,
  CruxSpanStatus,
} from '../../observability/contract'
import { currentObservabilityTransport, observe, setObservabilityTransport } from '../../observability'
import type { TokenUsage } from '../../types'
import type { Capability } from '../target'

// ─────────────────────────────────────────────────────────────────
// Signal model
// ─────────────────────────────────────────────────────────────────

/** One model invocation, from a `generation.*` span. @internal */
export interface ModelCallSignal {
  /** Observability span that produced this signal. */
  spanId: string
  model?: string
  provider?: string
  durationMs: number
  costUsd?: number
  usage?: TokenUsage
}

/** One tool invocation, from a `tool.call` span + its artifacts. @internal */
export interface ToolCallSignal {
  /** Observability span that produced this signal. */
  spanId: string
  tool: string
  args?: Record<string, unknown>
  result?: unknown
  succeeded: boolean
}

/** One flow/agent step, from a `flow.step` span + its output artifact. @internal */
export interface StepSignal {
  /** Observability span that produced this signal. */
  spanId: string
  name: string
  status: 'succeeded' | 'failed' | 'skipped'
  durationMs: number
  output: unknown
  hasOutput: boolean
}

/** One delegation hop, from `handoff.prepare` spans/payload artifacts. @internal */
export interface HandoffSignal {
  /** Observability span that produced this signal. */
  spanId: string
  from?: string
  to?: string
}

/** One retrieval hit, from `retrieval.hits` artifacts. @internal */
export interface RetrievalHitSignal {
  /** Observability span that produced this signal. */
  spanId: string
  rank?: number
  sourceId?: string
  chunkId?: string
  namespace?: string
  score?: number
  [key: string]: unknown
}

/** One citation marker, from `citation.report` artifacts. @internal */
export interface CitationSignal {
  /** Observability span that produced this signal. */
  spanId: string
  sourceId?: string
  grounded?: boolean
  outputQuote?: string
}

/** One guardrail outcome, from `guardrail.run` spans/report artifacts. @internal */
export interface GuardrailSignal {
  /** Observability span that produced this signal. */
  spanId: string
  id?: string
  action: string
}

/** One constraint outcome, from `constraint.check` spans/report artifacts. @internal */
export interface ConstraintSignal {
  /** Observability span that produced this signal. */
  spanId: string
  id?: string
  pass: boolean
}

/** One memory operation, from `memory.read`/`memory.write` spans. @internal */
export interface MemoryOpSignal {
  /** Observability span that produced this signal. */
  spanId: string
  op: 'read' | 'write'
  keys: readonly string[]
  /** key → stored value, when the diff/snapshot artifacts expose it. */
  values: Readonly<Record<string, unknown>>
}

/** One routing decision, from `routing.*` spans/report artifacts. @internal */
export interface RoutingSignal {
  /** Observability span that produced this signal. */
  spanId: string
  chosen?: string
  classifiedAs?: string
  selectedModel?: string
}

/** Everything the bound expect runtime reads for one cell. @internal */
export interface CellSignals {
  /** Signal families actually captured in THIS execution (drives honest-fail). */
  captured: ReadonlySet<Capability>
  modelCalls: readonly ModelCallSignal[]
  toolCalls: readonly ToolCallSignal[]
  steps: readonly StepSignal[]
  handoffs: readonly HandoffSignal[]
  retrievalHits: readonly RetrievalHitSignal[]
  citations: readonly CitationSignal[]
  guardrails: readonly GuardrailSignal[]
  constraints: readonly ConstraintSignal[]
  memoryOps: readonly MemoryOpSignal[]
  routing: readonly RoutingSignal[]
  /** Completed span durations — the population behind `latency.p95()`. */
  operationDurations: readonly number[]
  /** Count of spans that ended with `error` status. */
  erroredSpans: number
  /** Retry count: `fallback.attempt` + `constraint.retry` spans. */
  retries: number
  /** Whether any fallback model attempt occurred. */
  usedFallback: boolean
  /** Summed generation cost across the cell. */
  costUsd?: number
  /** Summed token usage across the cell. */
  usage?: TokenUsage
}

/** An empty signal set (plain functions capture nothing). @internal */
export function emptyCellSignals(): CellSignals {
  return {
    captured: new Set<Capability>(),
    modelCalls: [],
    toolCalls: [],
    steps: [],
    handoffs: [],
    retrievalHits: [],
    citations: [],
    guardrails: [],
    constraints: [],
    memoryOps: [],
    routing: [],
    operationDurations: [],
    erroredSpans: 0,
    retries: 0,
    usedFallback: false,
  }
}

// ─────────────────────────────────────────────────────────────────
// Capture
// ─────────────────────────────────────────────────────────────────

/** A per-run record capture teeing into any previously configured transport. @internal */
export interface SignalCapture {
  /** Records captured for one observed run (one cell). */
  take(runId: string): CruxGraphRecord[]
  /** Drain pending deliveries so `take()` sees everything emitted so far. */
  settle(): Promise<void>
  /** Restore the previously configured transport. */
  dispose(): void
}

/**
 * Install the capturing tee transport. Existing transports (devtools) keep
 * receiving everything; the capture buckets records per `runId` so concurrent
 * cells partition exactly.
 *
 * @internal
 */
export function installSignalCapture(): SignalCapture {
  const previous = currentObservabilityTransport()
  const byRun = new Map<string, CruxGraphRecord[]>()
  const restore = setObservabilityTransport({
    send(records) {
      for (const record of records) {
        const bucket = byRun.get(record.runId)
        if (bucket) bucket.push(record)
        else byRun.set(record.runId, [record])
      }
      return previous?.send(records)
    },
  })
  return {
    take(runId) {
      return byRun.get(runId) ?? []
    },
    async settle() {
      // The tee receives records synchronously when the queue dispatches —
      // flush()'s first iteration performs that dispatch. Waiting longer only
      // serves FORWARDING deliveries (devtools), which are not the runner's
      // job and can hang indefinitely when a dead transport is configured
      // (observe.flush awaits the global pendingDeliveries set). A short
      // grace covers microtask-async emitters without holding cells hostage.
      await observe.flush({ timeoutMs: 250 })
    },
    dispose() {
      restore()
    },
  }
}

// ─────────────────────────────────────────────────────────────────
// Extraction
// ─────────────────────────────────────────────────────────────────

interface CompletedSpan {
  spanId: string
  primitive: string
  name: string
  status: Exclude<CruxSpanStatus, 'running'> | 'running'
  durationMs: number
  attributes: Record<string, unknown>
  metrics?: CruxMetrics
  model?: string
  provider?: string
  toolName?: string
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Extract the typed per-cell signal model from one observed run's records.
 * Reads ONLY the canonical span/artifact contract — no output-shape guessing.
 *
 * @internal
 */
export function extractCellSignals(records: readonly CruxGraphRecord[]): CellSignals {
  const spans = new Map<string, CompletedSpan>()
  const artifactsBySpan = new Map<string, CruxArtifactRecord[]>()
  let runErrored = false

  for (const record of records) {
    if (record.type === 'span:start' || record.type === 'span') {
      const existing = spans.get(record.spanId)
      const attributes = { ...(existing?.attributes ?? {}), ...asRecord(record.attributes) }
      // Record-level fields when present; adapters commonly carry model and
      // provider in span attributes (orchestrateGenerate), so fall back.
      const recordModel = record.type === 'span:start' ? record.model : undefined
      const recordProvider = record.type === 'span:start' ? record.provider : undefined
      const recordToolName = record.type === 'span:start' ? record.toolName : undefined
      const model = stringOrUndefined(recordModel) ?? stringOrUndefined(attributes.model)
      const provider = stringOrUndefined(recordProvider) ?? stringOrUndefined(attributes.provider)
      const toolName = stringOrUndefined(recordToolName) ?? stringOrUndefined(attributes.toolName)
      spans.set(record.spanId, {
        spanId: record.spanId,
        primitive: record.primitive,
        name: record.name,
        status: record.type === 'span' ? record.status : (existing?.status ?? 'running'),
        durationMs: record.type === 'span' ? (record.durationMs ?? 0) : (existing?.durationMs ?? 0),
        attributes,
        ...(record.type === 'span' && record.metrics ? { metrics: record.metrics } : {}),
        ...(model !== undefined ? { model } : {}),
        ...(provider !== undefined ? { provider } : {}),
        ...(toolName !== undefined ? { toolName } : {}),
      })
    } else if (record.type === 'span:end') {
      const existing = spans.get(record.spanId)
      if (existing) {
        existing.status = record.status
        existing.durationMs = record.durationMs ?? existing.durationMs
        existing.attributes = { ...existing.attributes, ...asRecord(record.attributes) }
        if (record.metrics) existing.metrics = { ...existing.metrics, ...record.metrics }
      }
    } else if (record.type === 'span:event') {
      // Adapters report usage/cost via 'usage.observed' events on the
      // generation span (orchestrateGenerate) — merge into span metrics.
      if (record.name === 'usage.observed') {
        const existing = spans.get(record.spanId)
        if (existing) {
          const attrs = asRecord(record.attributes)
          const numeric: Record<string, number> = {}
          for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'costUsd']) {
            if (typeof attrs[key] === 'number') numeric[key] = attrs[key]
          }
          existing.metrics = { ...existing.metrics, ...numeric }
        }
      }
    } else if (record.type === 'artifact' && record.spanId !== undefined) {
      const bucket = artifactsBySpan.get(record.spanId)
      if (bucket) bucket.push(record)
      else artifactsBySpan.set(record.spanId, [record])
    } else if (record.type === 'run:end' && record.status === 'error') {
      runErrored = true
    }
  }

  const captured = new Set<Capability>()
  const modelCalls: ModelCallSignal[] = []
  const toolCalls: ToolCallSignal[] = []
  const steps: StepSignal[] = []
  const handoffs: HandoffSignal[] = []
  const retrievalHits: RetrievalHitSignal[] = []
  const citations: CitationSignal[] = []
  const guardrails: GuardrailSignal[] = []
  const constraints: ConstraintSignal[] = []
  const memoryOps: MemoryOpSignal[] = []
  const routing: RoutingSignal[] = []
  const operationDurations: number[] = []
  let erroredSpans = runErrored ? 1 : 0
  let retries = 0
  let usedFallback = false
  let costUsd: number | undefined
  let usage: TokenUsage | undefined

  const artifactPreview = (spanId: string, kind: string): unknown => {
    const artifact = artifactsBySpan.get(spanId)?.find((entry) => entry.kind === kind)
    return artifact?.preview
  }

  for (const span of spans.values()) {
    if (span.status !== 'running') operationDurations.push(span.durationMs)
    if (span.status === 'error') erroredSpans += 1

    switch (span.primitive) {
      case 'generation.call':
      case 'generation.stream': {
        captured.add('modelCalls')
        const metrics = span.metrics ?? {}
        const callUsage: TokenUsage = {
          ...(metrics.inputTokens !== undefined ? { inputTokens: metrics.inputTokens } : {}),
          ...(metrics.outputTokens !== undefined ? { outputTokens: metrics.outputTokens } : {}),
          ...(metrics.totalTokens !== undefined ? { totalTokens: metrics.totalTokens } : {}),
        }
        modelCalls.push({
          spanId: span.spanId,
          ...(span.model !== undefined ? { model: span.model } : {}),
          ...(span.provider !== undefined ? { provider: span.provider } : {}),
          durationMs: span.durationMs,
          ...(metrics.costUsd !== undefined ? { costUsd: metrics.costUsd } : {}),
          ...(Object.keys(callUsage).length > 0 ? { usage: callUsage } : {}),
        })
        if (metrics.costUsd !== undefined) costUsd = (costUsd ?? 0) + metrics.costUsd
        if (Object.keys(callUsage).length > 0) {
          usage = {
            inputTokens: (usage?.inputTokens ?? 0) + (callUsage.inputTokens ?? 0),
            outputTokens: (usage?.outputTokens ?? 0) + (callUsage.outputTokens ?? 0),
          }
        }
        break
      }
      case 'fallback.attempt': {
        captured.add('modelCalls')
        retries += 1
        usedFallback = true
        break
      }
      case 'tool.call': {
        captured.add('toolCalls')
        const args = artifactPreview(span.spanId, 'tool.args')
        const result = artifactPreview(span.spanId, 'tool.result')
        toolCalls.push({
          spanId: span.spanId,
          tool: span.toolName ?? stringOrUndefined(span.attributes.toolName) ?? span.name,
          ...(args !== undefined ? { args: asRecord(args) } : {}),
          ...(result !== undefined ? { result } : {}),
          succeeded: span.status === 'ok',
        })
        break
      }
      case 'flow.step': {
        captured.add('steps')
        const output = artifactPreview(span.spanId, 'output')
        steps.push({
          spanId: span.spanId,
          name: stringOrUndefined(span.attributes.stepLabel) ?? span.name,
          status: span.status === 'ok' ? 'succeeded' : span.status === 'skipped' ? 'skipped' : 'failed',
          durationMs: span.durationMs,
          output,
          hasOutput: output !== undefined,
        })
        break
      }
      case 'flow.run': {
        captured.add('steps')
        break
      }
      case 'handoff.prepare': {
        captured.add('handoffs')
        const payload = artifactPreview(span.spanId, 'handoff.payload') as CruxHandoffPayloadPreview | undefined
        handoffs.push({
          spanId: span.spanId,
          ...(stringOrUndefined(payload?.fromAgent ?? span.attributes.fromAgent) !== undefined
            ? { from: stringOrUndefined(payload?.fromAgent ?? span.attributes.fromAgent) }
            : {}),
          ...(stringOrUndefined(payload?.toAgent ?? span.attributes.toAgent) !== undefined
            ? { to: stringOrUndefined(payload?.toAgent ?? span.attributes.toAgent) }
            : {}),
        })
        break
      }
      case 'retrieval.pipeline':
      case 'retrieval.query':
      case 'retrieval.stage': {
        captured.add('retrieval')
        const preview = artifactPreview(span.spanId, 'retrieval.hits') as CruxRetrievalHitsPreview | undefined
        if (preview?.hits !== undefined) {
          for (const hit of preview.hits) retrievalHits.push({ ...hit, spanId: span.spanId })
        }
        break
      }
      case 'citation.check': {
        captured.add('citations')
        const preview = artifactPreview(span.spanId, 'citation.report') as CruxCitationReportPreview | undefined
        for (const marker of preview?.markers ?? []) {
          citations.push({
            spanId: span.spanId,
            ...(marker.sourceId !== undefined ? { sourceId: marker.sourceId } : {}),
            ...(marker.grounded !== undefined ? { grounded: marker.grounded } : {}),
            ...(marker.outputQuote !== undefined ? { outputQuote: marker.outputQuote } : {}),
          })
        }
        break
      }
      case 'guardrail.run': {
        captured.add('safety')
        const preview = artifactPreview(span.spanId, 'guardrail.report') as CruxGuardrailReportPreview | undefined
        guardrails.push({
          spanId: span.spanId,
          ...(stringOrUndefined(span.attributes.guardrailId) !== undefined
            ? { id: stringOrUndefined(span.attributes.guardrailId) }
            : { id: span.name }),
          action: preview?.action ?? (span.status === 'blocked' ? 'block' : 'pass'),
        })
        break
      }
      case 'constraint.check': {
        captured.add('safety')
        const preview = artifactPreview(span.spanId, 'constraint.report') as CruxConstraintReportPreview | undefined
        constraints.push({
          spanId: span.spanId,
          ...(stringOrUndefined(preview?.constraint ?? span.attributes.constraintId) !== undefined
            ? { id: stringOrUndefined(preview?.constraint ?? span.attributes.constraintId) }
            : { id: span.name }),
          pass: preview?.pass ?? span.status === 'ok',
        })
        break
      }
      case 'constraint.retry': {
        captured.add('safety')
        retries += 1
        break
      }
      case 'memory.read':
      case 'memory.write': {
        captured.add('memory')
        const keys = new Set<string>()
        const values: Record<string, unknown> = {}
        const blockKey = stringOrUndefined(span.attributes.key) ?? stringOrUndefined(span.attributes.blockId)
        if (blockKey !== undefined) keys.add(blockKey)
        const recall = artifactPreview(span.spanId, 'memory.recall') as CruxMemoryRecallPreview | undefined
        for (const block of recall?.blocks ?? []) {
          keys.add(block.key)
          values[block.key] = block.preview
        }
        const diff = artifactPreview(span.spanId, 'memory.diff') as CruxMemoryDiffPreview | undefined
        if (diff?.after !== undefined && blockKey !== undefined) values[blockKey] = diff.after
        memoryOps.push({
          spanId: span.spanId,
          op: span.primitive === 'memory.read' ? 'read' : 'write',
          keys: [...keys],
          values,
        })
        break
      }
      case 'routing.router':
      case 'routing.cascade': {
        captured.add('routing')
        const preview = artifactPreview(span.spanId, 'routing.report') as CruxRoutingReportPreview | undefined
        routing.push({
          spanId: span.spanId,
          ...(stringOrUndefined(preview?.chosen ?? span.attributes.chosen) !== undefined
            ? { chosen: stringOrUndefined(preview?.chosen ?? span.attributes.chosen) }
            : {}),
          ...(stringOrUndefined(preview?.classifiedAs ?? span.attributes.classifiedAs) !== undefined
            ? { classifiedAs: stringOrUndefined(preview?.classifiedAs ?? span.attributes.classifiedAs) }
            : {}),
          ...(stringOrUndefined(preview?.selectedModel ?? span.attributes.selectedModel ?? span.attributes.model) !==
          undefined
            ? {
                selectedModel: stringOrUndefined(
                  preview?.selectedModel ?? span.attributes.selectedModel ?? span.attributes.model,
                ),
              }
            : {}),
        })
        break
      }
      default:
        break
    }
  }

  return {
    captured,
    modelCalls,
    toolCalls,
    steps,
    handoffs,
    retrievalHits,
    citations,
    guardrails,
    constraints,
    memoryOps,
    routing,
    operationDurations,
    erroredSpans,
    retries,
    usedFallback,
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(usage !== undefined ? { usage } : {}),
  }
}
