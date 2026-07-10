/**
 * Stateful rolling context compaction with a sliding message window.
 *
 * Maintains a running summary of evicted messages plus a window of recent
 * messages kept verbatim. Uses `RecordStore` for persistence and
 * `summarizeMessages()` for compaction.
 *
 * @module
 */

import type { Message } from "../generation/messages";
import type {
  SlidingWindowConfig,
  SlidingWindow,
  SlidingWindowStats,
} from "./types";
import { inMemoryRecordStore } from "../storage";
import { inMemoryAssetStore } from "../asset";
import { countTokens } from "../shared/tokenizer";
import { summarizeMessages } from "./summarize";
import {
  loadSlidingWindowState,
  saveSlidingWindowState,
} from "./sliding-window-storage";

/**
 * Create a stateful sliding window compaction manager.
 *
 * Messages are appended via `push()`. When the window overflows, the oldest
 * messages are evicted and merged into a running summary. `getMessages()`
 * returns the compacted array ready for model consumption.
 *
 * @param config - Window configuration including size, generate fn, and model.
 * @returns A `SlidingWindow` instance with push/getMessages/getStats methods.
 */
export function createSlidingWindow(
  config: SlidingWindowConfig,
): SlidingWindow {
  const {
    windowSize,
    generate,
    model,
    summaryBudget = 1000,
    id = "default",
  } = config;
  const storage = config.storage ?? {
    records: inMemoryRecordStore(),
    assets: inMemoryAssetStore(),
  };
  const stateKey = `compact:${id}:state`;

  // In-memory stats tracking
  let totalMessages = 0;
  let evictions = 0;
  let summaryTokens = 0;

  async function push(message: Message): Promise<void> {
    const current = await loadSlidingWindowState(storage, stateKey);
    const messages = [...current.messages];
    messages.push(message);
    let nextSummary = current.summary;
    let evictedCount = 0;

    if (messages.length > windowSize) {
      // Evict oldest messages beyond the window
      const evictCount = messages.length - windowSize;
      const evicted = messages.splice(0, evictCount);
      evictedCount = evictCount;

      // Merge evicted messages into the running summary
      const toSummarize: Message[] = current.summary
        ? [
            { role: "system", content: `Previous summary: ${current.summary}` },
            ...evicted,
          ]
        : evicted;

      const result = await summarizeMessages({
        messages: toSummarize,
        generate,
        model,
        maxTokens: summaryBudget,
        focus: ["decisions", "key_facts", "user_preferences"],
      });

      nextSummary = result.summary;
    }

    await saveSlidingWindowState(storage, stateKey, {
      summary: nextSummary,
      messages,
    });
    totalMessages += 1;
    evictions += evictedCount;
    summaryTokens = countTokens(nextSummary);
  }

  async function getMessages(): Promise<Message[]> {
    const { summary, messages } = await loadSlidingWindowState(
      storage,
      stateKey,
    );

    if (summary) {
      return [
        {
          role: "system" as const,
          content: `Summary of earlier conversation:\n${summary}`,
        },
        ...messages,
      ];
    }

    return [...messages];
  }

  function getStats(): SlidingWindowStats {
    return {
      totalMessages,
      windowedMessages: Math.min(totalMessages, windowSize),
      summaryTokens,
      evictions,
    };
  }

  return { push, getMessages, getStats };
}
