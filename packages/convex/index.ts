/**
 * `@crux/convex` — Convex storage adapter for Crux.
 *
 * Provides `defineConvexStoreContract()` for creating server-side stores and
 * React transports backed by the same Convex store document contract.
 *
 * **Setup:** Install the crux Convex component and use the component ref:
 *
 * ```ts
 * import { defineConvexStoreContract } from '@crux/convex'
 * import { components } from './_generated/api'
 *
 * const cruxDocuments = defineConvexStoreContract({ component: components.crux })
 * const store = cruxDocuments.store(ctx)
 * ```
 *
 * @module
 */

export { convexWorkspaceBlobStore } from './workspace'
export type { ConvexWorkspaceBlobStoreConfig } from './workspace'
export { flushObservability, withObservabilityFlush } from './observability'
export type { ConvexActionHandler, ConvexObservabilityFlushOptions } from './observability'
export { setup } from './bridge'
export type { CruxConvexBridgeHttpRouter, CruxConvexBridgeSetupOptions } from './bridge'
export { createConvexRuntimeBridge } from './runtime-bridge'
export type {
  ConvexRunScope,
  ConvexRuntimeBridge,
  ConvexRuntimeBridgeSetupOptions,
  CreateConvexRuntimeBridgeOptions,
} from './runtime-bridge'
export { createCruxConvex } from './profile'
export type {
  CreateCruxConvexOptions,
  CruxConvexComponents,
  CruxConvexProfile,
  CruxConvexProfileAgentConfig,
  CruxConvexRunScope,
} from './profile'
export { defineConvexStoreContract } from './store-contract'
export type { ConvexContext, ConvexCtxPort } from './store'
export type {
  ConvexStoreContract,
  ConvexStoreContractTransportOptions,
  ConvexStoreSemanticCacheOptions,
  DefineConvexStoreContractOptions,
} from './store-contract'
export type {
  ConvexCruxStoreComponent,
  ConvexCruxStoreMemoryComponent,
  ConvexCruxStoreTransportComponent,
} from './store-component'
export {
  context,
  contributor,
  createContexts,
  createPrompts,
  escapeXml,
  injectable,
  limit,
  match,
  prompt,
  raw,
  safe,
  truncate,
  userContent,
  when,
  wrap,
} from '@crux/core'
export type {
  AnyPrompt,
  ConditionalContext,
  Context,
  ContextDef,
  ContextEntry,
  ContextSystemArg,
  CompactionResult,
  ContributorConfig,
  ContributorContribution,
  ContributorEntry,
  MergedInput,
  Message,
  Prompt,
  PromptConfig,
  PromptTree,
  PromptTreeResult,
  ResolveOptions,
  ResolvedPrompt,
} from '@crux/core'
export {
  convexRuntimeStore,
  getConvexCruxRuntime,
  resolveConvexMemoryNamespace,
  runWithConvexCruxRuntime,
} from './runtime'
export type {
  ConvexCruxRuntime,
  ConvexMemoryNamespace,
  ConvexMemoryNamespaceArgs,
  ConvexRuntimeTarget,
} from './runtime'
export { convexAgent } from './agent'

import type { z } from 'zod'
import type { CompactionResult, Message, Context, ContextEntry, Prompt } from '@crux/core'
import type { GenerateTextFn } from '@crux/core/compaction'
import { summarizeMessages } from '@crux/core/compaction'
import { getRuntime, countTokens } from '@crux/core'
import type { ConvexContext } from './store'

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// Stateless Conversation Compaction
// ─────────────────────────────────────────────────────────────────

/** Arguments for `compactConversation()`. */
export interface CompactConversationArgs {
  /** Messages that just fell out of the recent window. */
  evictedMessages: Message[]
  /** Existing running summary from thread metadata (empty string if none). */
  existingSummary: string
  /** Text generation function. */
  generate: GenerateTextFn
  /** Cheap/fast model for summarization. */
  model: unknown
  /** Max tokens for the summary. Default: 1000. */
  summaryBudget?: number
}

/**
 * Stateless conversation compaction for Convex.
 *
 * Takes evicted messages + existing summary, returns a merged summary.
 * No internal state — caller manages persistence (thread metadata).
 * Designed for Convex's action-per-message model where createSlidingWindow
 * would lose state between invocations.
 *
 * @param args - Evicted messages, existing summary, generate fn, model
 * @returns Merged summary and token metrics
 */
export async function compactConversation(args: CompactConversationArgs): Promise<CompactionResult> {
  const { evictedMessages, existingSummary, generate, model, summaryBudget = 1000 } = args

  if (evictedMessages.length === 0 && !existingSummary) {
    return { summary: '', tokensBefore: 0, tokensAfter: 0, ratio: 1 }
  }

  if (evictedMessages.length === 0) {
    const tokens = countTokens(existingSummary)
    return { summary: existingSummary, tokensBefore: tokens, tokensAfter: tokens, ratio: 1 }
  }

  // Merge: prepend existing summary as context for the new evicted batch
  const messagesToSummarize: Message[] = existingSummary
    ? [{ role: 'system', content: `Previous conversation summary:\n${existingSummary}` }, ...evictedMessages]
    : evictedMessages

  // Count only the actual evicted message tokens (exclude the summary wrapper)
  const inputTokens =
    evictedMessages.reduce((sum, m) => sum + countTokens(m.content), 0) +
    (existingSummary ? countTokens(existingSummary) : 0)

  getRuntime().instrumentationHooks?.onCompactStart?.({
    reason: 'conversation-compaction',
    inputMessageCount: evictedMessages.length,
    inputTokens,
  })
  const start = Date.now()

  const result = await summarizeMessages({
    messages: messagesToSummarize,
    generate,
    model,
    maxTokens: summaryBudget,
    focus: ['decisions', 'key_facts', 'user_preferences'],
  })

  getRuntime().instrumentationHooks?.onCompactEnd?.({
    outputTokens: result.tokensAfter,
    compressionRatio: result.ratio,
    summaryPreview: result.summary.slice(0, 100),
    durationMs: Date.now() - start,
  })

  return result
}

// ─────────────────────────────────────────────────────────────────
// Context Handler Helper
// ─────────────────────────────────────────────────────────────────

/** Generic message type compatible with Convex Agent SDK's ModelMessage. */
interface SystemMessage {
  role: 'system'
  content: string
}

/** Arguments passed to the context handler by the Convex Agent SDK. */
export interface ContextHandlerArgs {
  allMessages: Array<{ role: string; content: unknown }>
  search: Array<{ role: string; content: unknown }>
  recent: Array<{ role: string; content: unknown }>
  inputMessages: Array<{ role: string; content: unknown }>
  inputPrompt: Array<{ role: string; content: unknown }>
  existingResponses: Array<{ role: string; content: unknown }>
  userId: string | undefined
  threadId: string | undefined
}

/** Configuration for `createContextHandler()`. */
export interface ContextHandlerConfig<TInput extends Record<string, unknown>> {
  /**
   * Handler that returns the contexts to compose and the input to pass to them.
   *
   * - `contexts`: Array of Context objects (from `context()`, `.asContext()`, etc.)
   * - `input`: Merged input object passed to each context's `.systemFn()`
   *
   * Memory `.asContext()` contexts resolve their own data from their backing store.
   * Only custom contexts (project, draft, compaction) need data in the input object.
   */
  handler: (ctx: ConvexContext, args: ContextHandlerArgs) => Promise<{ contexts: Context<z.ZodType>[]; input: TInput }>
}

/**
 * Create a composable context handler for the Convex Agent SDK.
 *
 * Replaces manual string concatenation in context handlers with declarative
 * context composition. Calls each context's `.systemFn(input)`, filters empties,
 * joins with double newlines, and returns Convex Agent-compatible messages.
 *
 * @example
 * ```ts
 * const contextHandler = createContextHandler({
 *   handler: async (ctx, args) => ({
 *     contexts: [
 *       currentDate,
 *       agentProjectContext,
 *       sessionMemory.asContext({ priority: 90 }),
 *       blackboard.asContext({ priority: 85 }),
 *     ],
 *     input: {
 *       lines: await fetchProjectLines(ctx, projectId),
 *     },
 *   }),
 * })
 * ```
 */
export function createContextHandler<TInput extends Record<string, unknown>>(
  config: ContextHandlerConfig<TInput>,
): (ctx: ConvexContext, args: ContextHandlerArgs) => Promise<Array<{ role: string; content: unknown }>> {
  return async (ctx, args) => {
    const { contexts, input } = await config.handler(ctx, args)

    // Resolve all contexts in parallel
    // Context.systemFn takes the merged input and returns the system text
    const parts = await Promise.all(
      contexts.map(async (c) => {
        try {
          const text = await c.systemFn(input as Record<string, unknown>)
          return typeof text === 'string' ? text : ''
        } catch {
          return ''
        }
      }),
    )

    const systemContent = parts.filter(Boolean).join('\n\n')

    if (!systemContent) {
      return args.allMessages
    }

    const systemMessage: SystemMessage = { role: 'system', content: systemContent }
    return [systemMessage, ...args.allMessages]
  }
}
