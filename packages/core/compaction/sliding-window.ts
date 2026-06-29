/**
 * Stateful rolling context compaction with a sliding message window.
 *
 * Maintains a running summary of evicted messages plus a window of recent
 * messages kept verbatim. Uses `MemoryStore` for persistence and
 * `summarizeMessages()` for compaction.
 *
 * @module
 */

import type { Message } from '../generation/messages'
import type { SlidingWindowConfig, SlidingWindow, SlidingWindowStats } from './types'
import { inMemoryCruxStore } from '../store/memory'
import { countTokens } from '../shared/tokenizer'
import { summarizeMessages } from './summarize'
import { getRuntime } from '../runtime/runtime'

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
export function createSlidingWindow(config: SlidingWindowConfig): SlidingWindow {
  const { windowSize, generate, model, summaryBudget = 1000, id = 'default' } = config
  const store = config.store ?? inMemoryCruxStore()

  const summaryKey = `compact:${id}:summary`
  const messagesKey = `compact:${id}:messages`

  // In-memory stats tracking
  let totalMessages = 0
  let evictions = 0
  let summaryTokens = 0

  async function loadMessages(): Promise<Message[]> {
    const entry = await store.get(messagesKey)
    if (!entry) return []
    return JSON.parse(entry.content as string) as Message[]
  }

  async function saveMessages(messages: Message[]): Promise<void> {
    await store.set(messagesKey, {
      content: JSON.stringify(messages),
      metadata: { type: 'sliding-window-messages', windowId: id },
    })
  }

  async function loadSummary(): Promise<string> {
    const entry = await store.get(summaryKey)
    return (entry?.content as string) ?? ''
  }

  async function saveSummary(summary: string): Promise<void> {
    summaryTokens = countTokens(summary)
    await store.set(summaryKey, {
      content: summary,
      metadata: { type: 'sliding-window-summary', windowId: id },
    })
  }

  async function push(message: Message): Promise<void> {
    const messages = await loadMessages()
    messages.push(message)
    totalMessages++

    if (messages.length > windowSize) {
      // Evict oldest messages beyond the window
      const evictCount = messages.length - windowSize
      const evicted = messages.splice(0, evictCount)
      evictions += evictCount

      // Merge evicted messages into the running summary
      const existingSummary = await loadSummary()
      const toSummarize: Message[] = existingSummary
        ? [{ role: 'system', content: `Previous summary: ${existingSummary}` }, ...evicted]
        : evicted

      const inputTokens = toSummarize.reduce((sum, m) => sum + countTokens(m.content), 0)
      const compactStart = Date.now()

      const result = await summarizeMessages({
        messages: toSummarize,
        generate,
        model,
        maxTokens: summaryBudget,
        focus: ['decisions', 'key_facts', 'user_preferences'],
      })

      await saveSummary(result.summary)

      const outputTokens = countTokens(result.summary)
    }

    await saveMessages(messages)
  }

  async function getMessages(): Promise<Message[]> {
    const [summary, messages] = await Promise.all([loadSummary(), loadMessages()])

    if (summary) {
      return [
        {
          role: 'system' as const,
          content: `Summary of earlier conversation:\n${summary}`,
        },
        ...messages,
      ]
    }

    return messages
  }

  function getStats(): SlidingWindowStats {
    return {
      totalMessages,
      windowedMessages: Math.min(totalMessages, windowSize),
      summaryTokens,
      evictions,
    }
  }

  return { push, getMessages, getStats }
}
