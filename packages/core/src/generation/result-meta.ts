/**
 * Result `_meta` conventions shared across generation orchestration.
 *
 * Adapters attach a `_meta` object to their results carrying usage, cost,
 * streaming, and fallback metadata. This module centralizes reading and merging
 * that convention field, plus projecting nested usage details into flat
 * observability attributes.
 *
 * @module
 * @internal
 */

import type { FallbackMeta } from './fallback'
import type { TokenUsage } from './types'

/** Metadata attached to generate/stream results by adapters. */
export interface ResultMeta {
  _meta?: {
    cost?: number
    costUsd?: number
    usage?: TokenUsage
    streaming?: {
      ttftMs?: number
      tokensPerSecond?: number
      totalChunks?: number
    }
    fallback?: FallbackMeta
    [key: string]: unknown
  }
}

/** Extract _meta from a result if it has the convention field. */
export function getMeta(result: unknown): ResultMeta['_meta'] | undefined {
  if (result && typeof result === 'object' && '_meta' in result) {
    return (result as ResultMeta)._meta
  }
  return undefined
}

/** Attach or merge _meta on a result. */
export function setMeta(result: unknown, meta: Partial<NonNullable<ResultMeta['_meta']>>): void {
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>
    const existing = (r._meta ?? {}) as Record<string, unknown>
    r._meta = { ...existing, ...meta }
  }
}

/**
 * Flatten the nested `_meta` usage/streaming shape into canonical observability
 * attributes, deriving `totalTokens` when only input/output are present.
 */
export function generationUsageAttributes(
  meta: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!meta) return undefined

  const attributes: Record<string, unknown> = {}
  const usage = isRecord(meta.usage) ? meta.usage : undefined
  if (usage) {
    copyNumberMetric(attributes, usage, 'inputTokens', ['inputTokens'])
    copyNumberMetric(attributes, usage, 'outputTokens', ['outputTokens'])
    copyNumberMetric(attributes, usage, 'totalTokens', ['totalTokens'])
    copyNumberMetric(attributes, usage, 'costUsd', ['costUsd', 'cost', 'totalCost'])
    copyNumberMetric(attributes, usage, 'ttftMs', ['ttftMs'])
    copyNumberMetric(attributes, usage, 'tokensPerSecond', ['tokensPerSecond'])

    const inputTokenDetails = isRecord(usage.inputTokenDetails) ? usage.inputTokenDetails : undefined
    if (inputTokenDetails) {
      copyNumberMetric(attributes, inputTokenDetails, 'cacheReadTokens', ['cacheReadTokens'])
      copyNumberMetric(attributes, inputTokenDetails, 'cacheWriteTokens', ['cacheWriteTokens'])
    }

    const outputTokenDetails = isRecord(usage.outputTokenDetails) ? usage.outputTokenDetails : undefined
    if (outputTokenDetails) {
      copyNumberMetric(attributes, outputTokenDetails, 'reasoningTokens', ['reasoningTokens'])
    }
  }

  copyNumberMetric(attributes, meta, 'costUsd', ['costUsd', 'cost', 'totalCost'])

  const streaming = isRecord(meta.streaming) ? meta.streaming : undefined
  if (streaming) {
    copyNumberMetric(attributes, streaming, 'ttftMs', ['ttftMs'])
    copyNumberMetric(attributes, streaming, 'tokensPerSecond', ['tokensPerSecond'])
    copyNumberMetric(attributes, streaming, 'totalChunks', ['totalChunks'])
  }

  if (typeof attributes.totalTokens !== 'number') {
    const inputTokens = typeof attributes.inputTokens === 'number' ? attributes.inputTokens : 0
    const outputTokens = typeof attributes.outputTokens === 'number' ? attributes.outputTokens : 0
    const totalTokens = inputTokens + outputTokens
    if (totalTokens > 0) {
      attributes.totalTokens = totalTokens
    }
  }

  return Object.keys(attributes).length > 0 ? attributes : undefined
}

function copyNumberMetric(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  canonicalKey: string,
  sourceKeys: readonly string[],
): void {
  if (target[canonicalKey] !== undefined) return
  for (const sourceKey of sourceKeys) {
    const value = source[sourceKey]
    if (typeof value === 'number' && Number.isFinite(value)) {
      target[canonicalKey] = value
      return
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
