/** Usage accumulation for canonical language-model step facts. @internal */

import type { TokenUsage } from "../generation/types";
import type { ResultStepFacts } from "./result-accumulator";

/** Sum usage only when every recorded step is metered. */
export function sumUsageWhenComplete(
  steps: readonly ResultStepFacts[],
): TokenUsage | undefined {
  if (steps.length === 0 || steps.some((step) => step.usage === undefined))
    return undefined;

  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let cacheReadTokens: number | undefined;
  let cacheWriteTokens: number | undefined;
  let reasoningTokens: number | undefined;

  for (const step of steps) {
    const usage = step.usage;
    if (!usage) return undefined;
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
    totalTokens += usage.totalTokens;
    if (usage.inputTokenDetails.cacheReadTokens !== undefined) {
      cacheReadTokens =
        (cacheReadTokens ?? 0) + usage.inputTokenDetails.cacheReadTokens;
    }
    if (usage.inputTokenDetails.cacheWriteTokens !== undefined) {
      cacheWriteTokens =
        (cacheWriteTokens ?? 0) + usage.inputTokenDetails.cacheWriteTokens;
    }
    if (usage.outputTokenDetails.reasoningTokens !== undefined) {
      reasoningTokens =
        (reasoningTokens ?? 0) + usage.outputTokenDetails.reasoningTokens;
    }
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    inputTokenDetails: {
      ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
      ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    },
    outputTokenDetails: {
      ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    },
  };
}
