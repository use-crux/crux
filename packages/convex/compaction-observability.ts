import { observe } from '@use-crux/core/observability'
import type { CompactionResult } from '@use-crux/core'

export interface ObserveConversationCompactionOptions {
  readonly inputMessageCount: number
  readonly inputTokens: number
  readonly run: () => Promise<CompactionResult>
}

/**
 * Run Convex conversation compaction inside the canonical `compaction.run`
 * span and attach the output summary metrics to the terminal record.
 */
export async function observeConversationCompaction(
  options: ObserveConversationCompactionOptions,
): Promise<CompactionResult> {
  const span = observe.openSpan({
    name: 'conversation compaction',
    primitive: 'compaction.run',
    attributes: {
      reason: 'conversation-compaction',
      inputMessageCount: options.inputMessageCount,
      inputTokens: options.inputTokens,
    },
  })

  return await span.withContext(async () => {
    try {
      const result = await options.run()
      span.end({
        attributes: {
          outputTokens: result.tokensAfter,
          compressionRatio: result.ratio,
          summaryPreview: result.summary.slice(0, 100),
        },
      })
      return result
    } catch (error) {
      span.error(error, { phase: 'conversation-compaction' })
      throw error
    }
  })
}
