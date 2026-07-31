/**
 * Observability wiring for generate/stream orchestration.
 *
 * Builds the span attributes, deadline events, input/output artifact previews,
 * context-artifact edges, and live stream instrumentation that surround every
 * generation call. Kept separate from the orchestration control flow in
 * `orchestrate.ts` so the entry points read as policy, not telemetry plumbing.
 *
 * @module
 * @internal
 */

import { observe } from '../observability'
import type { ResolvedPrompt } from '../resolver/types'
import { readPromptTextObservation } from '../resolver/prompt-text-observation'
import type { OrchestrationSpec } from './orchestrate-types'
import { normalizeBudgetMs, type TimeoutOptions } from './timeout'
import type { GenerationPerformanceTracker } from './performance-metrics'
import { generationUsageAttributes } from './result-meta'
export { attachStreamObservability } from './stream-observability'

export function generationAttributes(
  spec: Pick<
    OrchestrationSpec<Record<string, unknown>>,
    | 'promptId'
    | 'provider'
    | 'model'
    | 'traceModel'
    | 'outputMode'
    | 'timeout'
  >,
  operation: 'generate' | 'stream',
): Record<string, unknown> {
  const totalTimeoutMs = normalizeTotalTimeoutMs(spec.timeout?.totalMs)
  return {
    operation,
    ...(spec.promptId ? { promptId: spec.promptId } : {}),
    ...(spec.provider ? { provider: spec.provider } : {}),
    ...(spec.traceModel
      ? { model: spec.traceModel }
      : typeof spec.model === 'string'
        ? { model: spec.model }
        : {}),
    ...(spec.outputMode ? { outputMode: spec.outputMode } : {}),
    ...(totalTimeoutMs ? { totalTimeoutMs, deadlineAt: new Date(Date.now() + totalTimeoutMs).toISOString() } : {}),
  }
}

export function emitOperationDeadline(totalMs: TimeoutOptions['totalMs']): void {
  const normalized = normalizeTotalTimeoutMs(totalMs)
  if (!normalized) return
  observe.event({
    name: 'operation.deadline',
    attributes: {
      totalTimeoutMs: normalized,
      deadlineAt: new Date(Date.now() + normalized).toISOString(),
    },
  })
}

function normalizeTotalTimeoutMs(totalMs: number | null | undefined): number | undefined {
  if (typeof totalMs !== 'number' || !Number.isFinite(totalMs) || totalMs <= 0) return undefined
  return Math.floor(totalMs)
}

export function generationInputPreview(
  spec: Pick<OrchestrationSpec<Record<string, unknown>>, 'preparedArgs' | 'input' | 'resolved'>,
): Record<string, unknown> {
  const prepared = spec.preparedArgs
  const toolNames = requestToolNames(prepared.tools) ?? requestToolNames(spec.resolved?.tools)
  const userPrompt = readPromptTextObservation(spec.resolved)
  return {
    input: spec.input,
    messages: prepared.messages,
    system: prepared.system,
    systemBlocks: prepared.systemBlocks,
    ...(userPrompt ? { userPrompt } : { prompt: spec.resolved?.prompt }),
    ...(toolNames ? { toolNames } : {}),
  }
}

function requestToolNames(tools: unknown): string[] | undefined {
  const names: string[] = []
  const push = (name: unknown): void => {
    if (typeof name !== 'string' || name.length === 0 || names.includes(name)) return
    names.push(name)
  }

  if (Array.isArray(tools)) {
    for (const tool of tools) {
      if (tool && typeof tool === 'object' && 'name' in tool) {
        push((tool as { name?: unknown }).name)
      }
    }
  } else if (tools && typeof tools === 'object') {
    for (const name of Object.keys(tools)) push(name)
  }

  return names.length > 0 ? names : undefined
}

export function linkResolvedContextArtifacts(resolved: ResolvedPrompt | undefined): void {
  const spanId = observe.captureContext()?.currentSpanId
  if (!spanId) return
  const seen = new Set<string>()
  for (const block of resolved?.systemBlocks ?? []) {
    if (!block.artifactId || block.source === 'prompt' || seen.has(block.artifactId)) continue
    seen.add(block.artifactId)
    observe.edge({
      edgeType: 'consumed',
      from: { kind: 'artifact', id: block.artifactId },
      to: { kind: 'span', id: spanId },
      attributes: {
        source: block.source,
        contextSource: block.source,
      },
    })
  }
}

export function generationOutputPreview(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object') return { value: result }
  const record = result as Record<string, unknown>
  return {
    text: record.text,
    object: record.object,
    meta: record._meta,
  }
}

export function linkActiveSpanToArtifact(
  edgeType: 'consumed' | 'produced',
  artifactId: ReturnType<typeof observe.artifact>,
): void {
  if (!artifactId) return
  const spanId = observe.captureContext()?.currentSpanId
  if (!spanId) return
  observe.edge({
    edgeType,
    from: { kind: 'span', id: spanId },
    to: { kind: 'artifact', id: artifactId },
  })
}
