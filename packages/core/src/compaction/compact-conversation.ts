/**
 * Stateless conversation compaction with an operation-owned result envelope.
 *
 * @module
 */

import type { CompactionResult, Message } from "../generation/messages";
import { observe } from "../observability";
import { withOperationResultMeta } from "../observability/internal/result-meta";
import { countTokens } from "../shared/tokenizer";
import { messageText } from "../content";
import { summarizeMessages } from "./summarize";
import type { CompactConversationArgs } from "./types";

type CompactionResultPayload = Omit<CompactionResult, "_meta">;

/**
 * Merge evicted messages into an existing conversation summary.
 *
 * The returned metadata identifies this conversation-level operation. When
 * generation is required, the nested {@link summarizeMessages} call remains
 * independently observed and its child result is restamped at this boundary.
 * Empty inputs and summary-only inputs still open a real operation span but do
 * not invoke the supplied generation function.
 *
 * @param args - Evicted messages, existing summary, generator, and model.
 * @returns The merged summary and token metrics with exact operation metadata.
 */
export async function compactConversation(
  args: CompactConversationArgs,
): Promise<CompactionResult> {
  const {
    evictedMessages,
    existingSummary,
    generate,
    model,
    summaryBudget = 1000,
    media,
  } = args;
  const inputTokens =
    evictedMessages.reduce(
      (sum, message) => sum + countTokens(messageText(message)),
      0,
    ) + (existingSummary ? countTokens(existingSummary) : 0);
  const span = observe.openSpan({
    name: "conversation compaction",
    primitive: "compaction.run",
    attributes: {
      reason: "conversation-compaction",
      inputMessageCount: evictedMessages.length,
      inputTokens,
    },
  });
  const operation = { traceId: span.traceId, spanId: span.spanId };

  try {
    const payload = await span.withContext(
      async (): Promise<CompactionResultPayload | CompactionResult> => {
        if (evictedMessages.length === 0 && !existingSummary) {
          return { summary: "", tokensBefore: 0, tokensAfter: 0, ratio: 1 };
        }

        if (evictedMessages.length === 0) {
          const tokens = countTokens(existingSummary);
          return {
            summary: existingSummary,
            tokensBefore: tokens,
            tokensAfter: tokens,
            ratio: 1,
          };
        }

        const messages: Message[] = existingSummary
          ? [
              {
                role: "system",
                content: `Previous conversation summary:\n${existingSummary}`,
              },
              ...evictedMessages,
            ]
          : [...evictedMessages];

        return summarizeMessages({
          messages,
          generate,
          model,
          maxTokens: summaryBudget,
          focus: ["decisions", "key_facts", "user_preferences"],
          media,
        });
      },
    );
    const result = withOperationResultMeta(payload, operation);
    span.end({
      attributes: {
        outputTokens: result.tokensAfter,
        compressionRatio: result.ratio,
        summaryPreview: result.summary.slice(0, 100),
      },
    });
    return result;
  } catch (error) {
    span.error(error, { phase: "conversation-compaction" });
    throw error;
  }
}
