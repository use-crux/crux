/**
 * Generation span performance metrics.
 *
 * Tracks client-side latency and throughput for generate/stream orchestration
 * and returns the canonical `gen.*` metrics attached to span-end records.
 *
 * @module
 * @internal
 */

import { generationUsageAttributes } from './result-meta'

export const GENERATION_DURATION_MS = 'gen.duration_ms'
export const GENERATION_TIME_TO_FIRST_TOKEN_MS = 'gen.time_to_first_token_ms'
export const GENERATION_OUTPUT_TOKENS_PER_SECOND = 'gen.output_tokens_per_second'
export const GENERATION_TIME_PER_OUTPUT_CHUNK_MS = 'gen.time_per_output_chunk_ms'

/** Tracks latency and throughput for a generation span. */
export interface GenerationPerformanceTracker {
  /** Record an observed streaming output chunk. */
  recordOutputChunk(): void
  /** Build span metrics at the point the generation span closes. */
  metrics(meta?: Record<string, unknown>): Record<string, number>
}

/** Create a per-span generation performance tracker. */
export function createGenerationPerformanceTracker(): GenerationPerformanceTracker {
  const startedAt = Date.now()
  let firstChunkAt: number | undefined
  let lastChunkAt: number | undefined
  let outputChunkCount = 0

  return {
    recordOutputChunk() {
      const timestamp = Date.now()
      firstChunkAt ??= timestamp
      lastChunkAt = timestamp
      outputChunkCount += 1
    },
    metrics(meta) {
      const durationMs = Math.max(0, Date.now() - startedAt)
      const usage = generationUsageAttributes(meta)
      const outputUnits = numberMetric(usage?.outputTokens) ?? (outputChunkCount > 0 ? outputChunkCount : undefined)
      const metrics: Record<string, number> = {
        [GENERATION_DURATION_MS]: durationMs,
      }
      const ttftMs = numberMetric(usage?.ttftMs) ?? (firstChunkAt !== undefined ? firstChunkAt - startedAt : undefined)
      if (ttftMs !== undefined) metrics[GENERATION_TIME_TO_FIRST_TOKEN_MS] = Math.max(0, ttftMs)
      const tokensPerSecond = numberMetric(usage?.tokensPerSecond) ?? throughput(outputUnits, durationMs)
      if (tokensPerSecond !== undefined) metrics[GENERATION_OUTPUT_TOKENS_PER_SECOND] = tokensPerSecond
      const timePerChunkMs = chunkInterval(firstChunkAt, lastChunkAt, outputChunkCount)
      if (timePerChunkMs !== undefined) metrics[GENERATION_TIME_PER_OUTPUT_CHUNK_MS] = timePerChunkMs
      return metrics
    },
  }
}

function throughput(outputUnits: number | undefined, durationMs: number): number | undefined {
  if (outputUnits === undefined) return undefined
  return outputUnits / (Math.max(durationMs, 1) / 1000)
}

function chunkInterval(
  firstChunkAt: number | undefined,
  lastChunkAt: number | undefined,
  outputChunkCount: number,
): number | undefined {
  if (firstChunkAt === undefined || lastChunkAt === undefined || outputChunkCount === 0) return undefined
  if (outputChunkCount === 1) return 0
  return Math.max(0, lastChunkAt - firstChunkAt) / (outputChunkCount - 1)
}

function numberMetric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
