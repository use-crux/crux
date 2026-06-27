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
import type { OrchestrationSpec } from './orchestrate-types'
import { generationUsageAttributes } from './result-meta'

export function generationAttributes(
  spec: Pick<
    OrchestrationSpec<Record<string, unknown>>,
    'promptId' | 'provider' | 'model' | 'outputMode' | 'timeoutMs'
  >,
  operation: 'generate' | 'stream',
): Record<string, unknown> {
  const timeoutMs = normalizeTimeoutMs(spec.timeoutMs)
  return {
    operation,
    ...(spec.promptId ? { promptId: spec.promptId } : {}),
    ...(spec.provider ? { provider: spec.provider } : {}),
    ...(typeof spec.model === 'string' ? { model: spec.model } : {}),
    ...(spec.outputMode ? { outputMode: spec.outputMode } : {}),
    ...(timeoutMs ? { timeoutMs, deadlineAt: new Date(Date.now() + timeoutMs).toISOString() } : {}),
  }
}

export function emitOperationDeadline(timeoutMs: number | undefined): void {
  const normalized = normalizeTimeoutMs(timeoutMs)
  if (!normalized) return
  observe.event({
    name: 'operation.deadline',
    attributes: {
      timeoutMs: normalized,
      deadlineAt: new Date(Date.now() + normalized).toISOString(),
    },
  })
}

function normalizeTimeoutMs(timeoutMs: number | undefined): number | undefined {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return undefined
  return Math.floor(timeoutMs)
}

export function generationInputPreview(
  spec: Pick<OrchestrationSpec<Record<string, unknown>>, 'preparedArgs' | 'input' | 'resolved'>,
): Record<string, unknown> {
  const prepared = spec.preparedArgs
  const toolNames = requestToolNames(prepared.tools) ?? requestToolNames(spec.resolved?.tools)
  return {
    input: spec.input,
    messages: prepared.messages,
    system: prepared.system,
    systemBlocks: prepared.systemBlocks,
    prompt: spec.resolved?.prompt,
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
  if (resolved?.promptBudgetArtifactId && !seen.has(resolved.promptBudgetArtifactId)) {
    observe.edge({
      edgeType: 'consumed',
      from: { kind: 'artifact', id: resolved.promptBudgetArtifactId },
      to: { kind: 'span', id: spanId },
      attributes: { primitive: 'prompt.budget' },
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

export function attachStreamObservability(result: unknown, span: ReturnType<typeof observe.openSpan>): void {
  if (!result || typeof result !== 'object') {
    span.end({ attributes: { streamCompleted: true, streamObservable: false } })
    return
  }
  const record = result as Record<string, unknown>
  const rawStream = record.rawStream
  const extractTextDelta = record.extractTextDelta
  const observesRawStream = isAsyncIterable(rawStream) && typeof extractTextDelta === 'function'
  if (observesRawStream) {
    record.rawStream = observedStream(rawStream, extractTextDelta as (chunk: unknown) => string | undefined, span)
  }

  const completion = record.completion
  if (typeof completion !== 'function') {
    if (!observesRawStream) {
      span.end({ attributes: { streamCompleted: true, completionAvailable: false } })
    }
    return
  }

  record.completion = async (...args: unknown[]) => {
    try {
      const meta = await span.withContext(() => (completion as (...inner: unknown[]) => Promise<unknown>)(...args))
      await span.withContext(() => {
        if (meta && typeof meta === 'object') {
          const metaRecord = meta as Record<string, unknown>
          const usageAttributes = generationUsageAttributes(metaRecord)
          if (usageAttributes) {
            observe.event({ name: 'usage.observed', attributes: usageAttributes })
          }
          const outputArtifactId = observe.artifact({
            kind: 'stream.timeline',
            contentType: 'application/json',
            encoding: 'json',
            preview: metaRecord,
          })
          linkActiveSpanToArtifact('produced', outputArtifactId)
        }
      })
      span.end()
      return meta
    } catch (error) {
      span.error(error)
      throw error
    }
  }
}

async function* observedStream(
  rawStream: AsyncIterable<unknown>,
  extractTextDelta: (chunk: unknown) => string | undefined,
  span: ReturnType<typeof observe.openSpan>,
): AsyncIterable<unknown> {
  let index = 0
  try {
    for await (const chunk of rawStream) {
      const delta = extractTextDelta(chunk)
      if (delta) {
        await span.withContext(() => {
          observe.event({
            name: 'token.delta',
            attributes: {
              index,
              text: delta,
              length: delta.length,
            },
          })
        })
        index += 1
      }
      yield chunk
    }
    span.end({ attributes: { streamCompleted: true, tokenDeltaCount: index } })
  } catch (error) {
    span.error(error)
    throw error
  }
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(value && typeof value === 'object' && Symbol.asyncIterator in value)
}
