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
import { TimeoutError, normalizeBudgetMs, type TimeoutOptions } from './timeout'
import type { GenerationPerformanceTracker } from './performance-metrics'
import { generationUsageAttributes } from './result-meta'
import { createStreamSpanFinalizer, type StreamSpanFinalizer } from './stream-finalizer'
import { createStreamTokenCoalescer } from './stream-token-coalescer'

export function generationAttributes(
  spec: Pick<
    OrchestrationSpec<Record<string, unknown>>,
    'promptId' | 'provider' | 'model' | 'outputMode' | 'timeout'
  >,
  operation: 'generate' | 'stream',
): Record<string, unknown> {
  const totalTimeoutMs = normalizeTotalTimeoutMs(spec.timeout?.totalMs)
  return {
    operation,
    ...(spec.promptId ? { promptId: spec.promptId } : {}),
    ...(spec.provider ? { provider: spec.provider } : {}),
    ...(typeof spec.model === 'string' ? { model: spec.model } : {}),
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

function normalizeTotalTimeoutMs(totalMs: number | undefined): number | undefined {
  if (typeof totalMs !== 'number' || !Number.isFinite(totalMs) || totalMs <= 0) return undefined
  return Math.floor(totalMs)
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

export function attachStreamObservability(
  result: unknown,
  span: ReturnType<typeof observe.openSpan>,
  performance: GenerationPerformanceTracker,
  chunkMs?: number,
): void {
  if (!result || typeof result !== 'object') {
    span.end({ attributes: { streamCompleted: true, streamObservable: false }, metrics: performance.metrics() })
    return
  }
  const record = result as Record<string, unknown>
  const rawStream = record.rawStream
  const extractTextDelta = record.extractTextDelta
  const observesRawStream = isAsyncIterable(rawStream) && typeof extractTextDelta === 'function'
  const completion = record.completion
  const observesCompletion = typeof completion === 'function'
  const finalizer = createStreamSpanFinalizer({
    span,
    performance,
    expectsStream: observesRawStream,
    expectsCompletion: observesCompletion,
  })

  if (observesRawStream) {
    record.rawStream = observedStream(
      rawStream,
      extractTextDelta as (chunk: unknown) => string | undefined,
      span,
      finalizer,
      performance,
      chunkMs,
    )
  }

  if (!observesCompletion) {
    if (!observesRawStream) {
      span.end({
        attributes: { streamCompleted: true, completionAvailable: false },
        metrics: performance.metrics(),
      })
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
      finalizer.completionSettled({
        meta: meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : undefined,
      })
      return meta
    } catch (error) {
      finalizer.completionErrored(error)
      throw error
    }
  }
}

async function* observedStream(
  rawStream: AsyncIterable<unknown>,
  extractTextDelta: (chunk: unknown) => string | undefined,
  span: ReturnType<typeof observe.openSpan>,
  finalizer: StreamSpanFinalizer,
  performance: GenerationPerformanceTracker,
  chunkMs?: number,
): AsyncIterable<unknown> {
  let completed = false
  let failed = false
  const normalizedChunkMs = normalizeBudgetMs(chunkMs)
  const tokenChunks = createStreamTokenCoalescer({
    emit: (attributes) => {
      void span.withContext(() => {
        observe.event({
          name: 'token.chunk',
          attributes,
        })
      })
    },
  })
  try {
    const iterator = rawStream[Symbol.asyncIterator]()
    while (true) {
      const next = await nextStreamChunk(iterator, normalizedChunkMs)
      if (next.done) break
      const chunk = next.value
      const delta = extractTextDelta(chunk)
      if (delta) {
        performance.recordOutputChunk()
        tokenChunks.add(delta)
      }
      yield chunk
    }
    completed = true
    tokenChunks.flush()
    finalizer.streamEnded({ tokenChunkCount: tokenChunks.chunkCount() })
  } catch (error) {
    failed = true
    tokenChunks.flush()
    finalizer.streamErrored({ tokenChunkCount: tokenChunks.chunkCount(), error })
    throw error
  } finally {
    if (!completed && !failed) {
      tokenChunks.flush()
      finalizer.streamReturned({ tokenChunkCount: tokenChunks.chunkCount() })
    }
  }
}

async function nextStreamChunk(
  iterator: AsyncIterator<unknown>,
  chunkMs: number | undefined,
): Promise<IteratorResult<unknown>> {
  if (chunkMs === undefined) return iterator.next()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      iterator.next(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError({ budget: 'chunk', limitMs: chunkMs })), chunkMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(value && typeof value === 'object' && Symbol.asyncIterator in value)
}
