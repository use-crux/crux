import { observe } from '@crux/core/observability'
import { isRecord } from './lifecycle-utils'

export type StreamTimingTracker = {
  markStarted: () => void
  recordChunk: (event: unknown) => void
  finish: (result: unknown) => Record<string, number> | undefined
}

export function createStreamTimingTracker(now: () => number = Date.now): StreamTimingTracker {
  let startedAt: number | undefined
  let firstOutputAt: number | undefined
  let totalChunks = 0

  const markStarted = () => {
    startedAt ??= now()
  }

  return {
    markStarted,
    recordChunk(event: unknown) {
      markStarted()
      if (!isOutputStreamChunkEvent(event)) return
      totalChunks += 1
      firstOutputAt ??= now()
    },
    finish(result: unknown) {
      markStarted()
      const finishedAt = now()
      const metrics: Record<string, number> = {}
      if (typeof firstOutputAt === 'number' && typeof startedAt === 'number') {
        metrics.ttftMs = Math.max(0, firstOutputAt - startedAt)
      }
      if (totalChunks > 0) {
        metrics.totalChunks = totalChunks
      }
      const usage = usageFromResult(result)
      if (usage?.outputTokens !== undefined && typeof firstOutputAt === 'number') {
        const streamingSeconds = Math.max((finishedAt - firstOutputAt) / 1000, 0.001)
        metrics.tokensPerSecond = usage.outputTokens / streamingSeconds
      }
      return Object.keys(metrics).length > 0 ? metrics : undefined
    },
  }
}

export function emitUsageEvent(result: unknown, fallbackMetrics?: Record<string, number>): void {
  const usage = mergeNumberMetrics(usageFromResult(result), fallbackMetrics)
  if (!usage) return
  observe.event({
    name: 'usage.observed',
    attributes: usage,
  })
}

export function modelSpanAttributes(model: unknown): Record<string, string> {
  const modelId = modelStringValue(model, ['modelId', 'model'])
  const provider = modelStringValue(model, ['provider', 'providerId'])
  return {
    ...(modelId ? { model: modelId } : {}),
    ...(provider ? { provider } : {}),
  }
}

export function numericValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function normalizeUsageWithCost(usageSource: unknown, costSource: unknown): Record<string, number> | undefined {
  const usage = normalizeUsage(usageSource) ?? {}
  const fallback = normalizeUsage(costSource)
  if (fallback) {
    for (const [key, value] of Object.entries(fallback)) {
      if (usage[key] === undefined) usage[key] = value
    }
  }
  return Object.keys(usage).length > 0 ? usage : undefined
}

function isOutputStreamChunkEvent(event: unknown): boolean {
  if (!isRecord(event)) return false
  const chunk = event.chunk
  if (!isRecord(chunk)) return false
  return chunk.type === 'text-delta' || chunk.type === 'reasoning-delta'
}

function usageFromResult(result: unknown): Record<string, number> | undefined {
  const record = isRecord(result) ? result : undefined
  if (!record) return undefined
  return normalizeUsageWithCost(record.usage ?? record.totalUsage, record)
}

function mergeNumberMetrics(
  primary: Record<string, number> | undefined,
  fallback: Record<string, number> | undefined,
): Record<string, number> | undefined {
  const merged: Record<string, number> = {}
  for (const source of [fallback, primary]) {
    if (!source) continue
    for (const [key, value] of Object.entries(source)) {
      if (typeof value === 'number' && Number.isFinite(value)) merged[key] = value
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}

function modelStringValue(model: unknown, keys: readonly string[]): string | undefined {
  if (typeof model === 'string') {
    return keys.includes('modelId') || keys.includes('model') ? model : undefined
  }
  if (!model || typeof model !== 'object') return undefined
  const record = model as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

function normalizeUsage(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const usage: Record<string, number> = {}
  for (const [target, source] of [
    ['inputTokens', 'inputTokens'],
    ['inputTokens', 'promptTokens'],
    ['outputTokens', 'outputTokens'],
    ['outputTokens', 'completionTokens'],
    ['totalTokens', 'totalTokens'],
    ['reasoningTokens', 'reasoningTokens'],
    ['cacheReadTokens', 'cacheReadTokens'],
    ['cacheReadTokens', 'cachedInputTokens'],
    ['cacheWriteTokens', 'cacheWriteTokens'],
    ['costUsd', 'costUsd'],
    ['costUsd', 'cost'],
    ['costUsd', 'totalCost'],
    ['ttftMs', 'ttftMs'],
    ['tokensPerSecond', 'tokensPerSecond'],
    ['totalChunks', 'totalChunks'],
  ] as const) {
    if (usage[target] !== undefined) continue
    const candidate = record[source]
    if (typeof candidate === 'number' && Number.isFinite(candidate)) usage[target] = candidate
  }
  return Object.keys(usage).length > 0 ? usage : undefined
}
