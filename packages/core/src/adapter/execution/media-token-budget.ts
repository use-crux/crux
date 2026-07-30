import type { Message } from '../../generation/messages'
import { observe } from '../../observability'
import type { ProviderMediaHooks } from '../native-chat/media-hooks'
import { estimateMessageTokens } from '../native-chat/media-tokens'

/** Estimate one prepared provider turn and emit safely labeled budget metrics. */
export function emitInputTokenEstimate(
  input: Readonly<{
    messages: readonly Message[];
    provider: string;
    model: string;
    media?: ProviderMediaHooks;
  }>,
): void {
  const estimate = estimateMessageTokens(input.messages, {
    provider: input.provider,
    model: input.model,
    ...(input.media?.estimateTokens ? { estimateTokens: input.media.estimateTokens } : {}),
  })
  observe.event({
    name: 'input.tokens.estimated',
    attributes: {
      estimatedInputTokens: estimate.totalTokens,
      estimatedMediaTokens: estimate.mediaTokens,
      estimateUsedFallback: estimate.usedFallback,
      mediaEstimateReason: estimate.reason,
    },
  })
}
