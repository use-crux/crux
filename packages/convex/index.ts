/**
 * `@crux/convex` — Convex storage adapter for Crux.
 *
 * Provides `cruxConvexStore()` that implements `CruxStore` backed by
 * Convex tables. Entries are persisted as Convex documents with full indexing.
 *
 * **Setup:** Install the crux Convex component and use the component ref:
 *
 * ```ts
 * import { cruxConvexStore } from '@crux/convex'
 * import { components } from './_generated/api'
 *
 * const store = cruxConvexStore({
 *   component: components.crux,
 *   ctx,
 * })
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

import type { ComponentApi } from './src/component/_generated/component'
import type { z } from 'zod'
import type {
  CruxStore,
  JsonObject,
  ListResult,
  StoreEntry,
  ScoredEntry,
  VectorSearchOptions,
  VectorSearchQuery,
  ListOptions,
  SetOptions,
} from '@crux/core/store'
import { toStoreValue } from '@crux/core/memory'
import type { RawMemoryDocument } from '@crux/core/memory'
import type { CompactionResult, Message, Context, ContextEntry, Prompt } from '@crux/core'
import type { GenerateTextFn } from '@crux/core/compaction'
import { summarizeMessages } from '@crux/core/compaction'
import { getRuntime, countTokens } from '@crux/core'
import { convexAgent as createConvexAgent } from './agent'
import type { ConvexAgentComponent, ConvexAgentConfig, CruxConvexAgent } from './agent'
import { runWithConvexCruxRuntime, type ConvexCruxRuntime, type ConvexRuntimeTarget } from './runtime'

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

/**
 * Minimal Convex context interface.
 *
 * Uses `unknown` for function refs since Convex's `FunctionReference` generic
 * is too deeply parameterized to replicate without importing Convex server types.
 * Type safety comes from the `ComponentApi` type at call sites.
 */
export interface ConvexContext {
  runQuery: <T = unknown>(fn: unknown, args: Record<string, unknown>) => Promise<T>
  runMutation: <T = unknown>(fn: unknown, args: Record<string, unknown>) => Promise<T>
  runAction?: <T = unknown>(fn: unknown, args: Record<string, unknown>) => Promise<T>
  vectorSearch?: (
    table: string,
    index: string,
    opts: { vector: number[]; limit?: number },
  ) => Promise<VectorSearchResult[]>
}

/** Raw result from ctx.vectorSearch — Convex returns documents with a _score field. */
interface VectorSearchResult {
  _id: string
  _score: number
  key: string
  content: string
  metadata?: Record<string, unknown>
  embedding?: number[]
  createdAt: number
  updatedAt: number
}

/** Configuration for the Convex store. */
export interface ConvexMemoryStoreConfig {
  /**
   * The crux component ref from `components.crux`.
   */
  component: ComponentApi

  /**
   * The Convex context (ActionCtx or MutationCtx).
   * Must have `runQuery` and `runMutation` methods.
   */
  ctx: ConvexContext

  /**
   * Vector index name for fallback vector search via ctx.vectorSearch.
   * Default: `'by_embedding'`.
   */
  vectorIndexName?: string

  /**
   * Declare this Convex store/index is dedicated to semantic cache entries.
   * Use this only when the backing table/index is not shared with memory or
   * retrieval vectors, because semantic cache lookup must not compete with
   * unrelated vectors before filtering.
   */
  semanticCache?: {
    isolatedVectorNamespace?: boolean
  }
}

// ─────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────

/**
 * Create a `CruxStore` backed by the crux Convex component.
 *
 * Uses the component's built-in memory table and CRUD functions.
 * No manual schema or function definitions needed.
 *
 * @param config - Component ref and Convex context.
 * @returns A `CruxStore` with full CRUD and optional vector search.
 *
 * @example
 * ```ts
 * import { cruxConvexStore } from '@crux/convex'
 * import { components } from './_generated/api'
 *
 * // In a Convex action:
 * const store = cruxConvexStore({
 *   component: components.crux,
 *   ctx,
 * })
 * ```
 */
export function cruxConvexStore(config: ConvexMemoryStoreConfig): CruxStore {
  const { component, ctx, vectorIndexName = 'by_embedding' } = config
  const fns = component.memory

  return {
    async get(key: string): Promise<JsonObject | null> {
      const doc = await ctx.runQuery<RawMemoryDocument | null>(fns.get, { key })
      if (!doc) return null
      // CruxStore documents are serialized as JSON in `content` with a marker
      let value: JsonObject
      if (doc.metadata && (doc.metadata as Record<string, unknown>)._cruxDoc) {
        value = JSON.parse(doc.content) as JsonObject
      } else {
        value = toStoreValue(doc)
      }
      // Check TTL expiry
      if (typeof value._expiresAt === 'number' && Date.now() >= value._expiresAt) {
        await ctx.runMutation(fns.remove, { key })
        return null
      }
      return value
    },

    async set(key: string, value: JsonObject, options?: SetOptions): Promise<void> {
      const now = Date.now()
      const stored = options?.ttl !== undefined && options.ttl > 0 ? { ...value, _expiresAt: now + options.ttl } : value
      await ctx.runMutation(fns.set, {
        key,
        content: JSON.stringify(stored),
        metadata: { _cruxDoc: true },
        embedding: value.embedding as number[] | undefined,
        updatedAt: now,
      })
    },

    async delete(key: string): Promise<void> {
      await ctx.runMutation(fns.remove, { key })
    },

    async list(prefix: string, options?: ListOptions): Promise<ListResult> {
      const docs = await ctx.runQuery<RawMemoryDocument[]>(fns.list, {
        prefix,
        limit: options?.limit,
        cursor: options?.cursor,
        filter: options?.filter,
      })
      const now = Date.now()
      const expiredKeys: string[] = []
      const entries: StoreEntry[] = (docs ?? [])
        .map((doc) => ({
          key: doc.key,
          value:
            doc.metadata && (doc.metadata as Record<string, unknown>)._cruxDoc
              ? (JSON.parse(doc.content) as JsonObject)
              : toStoreValue(doc),
        }))
        .filter((entry) => {
          if (typeof entry.value._expiresAt === 'number' && now >= entry.value._expiresAt) {
            expiredKeys.push(entry.key)
            return false
          }
          return true
        })

      // Clean up expired entries — awaited to avoid Convex dangling promise warnings
      if (expiredKeys.length > 0) {
        await Promise.all(expiredKeys.map((key) => ctx.runMutation(fns.remove, { key }).catch(() => {})))
      }

      return { entries }
    },

    vectorSearch(embedding: number[], options?: VectorSearchOptions): Promise<ScoredEntry[]> {
      return this.searchVectors!({
        dense: embedding,
        limit: options?.limit,
        threshold: options?.threshold,
        filter: options?.filter,
      })
    },

    async searchVectors(query: VectorSearchQuery): Promise<ScoredEntry[]> {
      if (!query.dense && !query.sparse) {
        throw new Error('Convex searchVectors() requires a dense query vector.')
      }
      if (query.sparse && query.dense) {
        throw new Error('Convex cruxConvexStore does not support hybrid dense+sparse retrieval.')
      }
      if (query.sparse) {
        throw new Error('Convex cruxConvexStore does not support sparse retrieval.')
      }
      if (!ctx.vectorSearch) {
        return []
      }

      const results = await ctx.vectorSearch('memories', vectorIndexName, {
        vector: query.dense!,
        limit: query.limit ?? 10,
      })

      return results
        .map((result) => ({
          key: result.key,
          value: decodeCruxValue(result),
          score: result._score ?? 0,
        }))
        .filter((result) => query.threshold === undefined || result.score >= query.threshold)
        .filter((result) => !query.filter || matchesTopLevelFilter(result.value, query.filter))
    },

    supportsTtl(): boolean {
      return true
    },

    capabilities() {
      return {
        ttl: true,
        vectorSearch: { dense: true, sparse: false, hybrid: false },
        semanticCache: { isolatedVectorNamespace: Boolean(config.semanticCache?.isolatedVectorNamespace) },
      }
    },
  }
}

function decodeCruxValue(doc: RawMemoryDocument): JsonObject {
  if (doc.metadata && (doc.metadata as Record<string, unknown>)._cruxDoc) {
    return JSON.parse(doc.content) as JsonObject
  }
  return toStoreValue(doc)
}

function matchesTopLevelFilter(value: JsonObject, filter: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(filter)) {
    const actual = value[key]
    if (expected === null) {
      if (actual !== null && actual !== undefined) {
        return false
      }
      continue
    }
    if (actual !== expected) {
      return false
    }
  }
  return true
}

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

export interface CruxConvexComponents {
  /**
   * Crux persistence component installed from `@crux/convex/convex.config`.
   */
  crux: ComponentApi

  /**
   * Convex Agent component installed from `@convex-dev/agent/convex.config`.
   */
  agent: ConvexAgentComponent
}

export type CruxConvexProfileAgentConfig<
  TPrompt extends Prompt<z.ZodType, z.ZodType | undefined, readonly ContextEntry[]>,
> = Omit<ConvexAgentConfig<TPrompt>, 'components' | 'store'>

export interface CruxConvexProfile {
  readonly components: CruxConvexComponents
  store(ctx: ConvexContext): CruxStore
  withRuntime<R, TCtx extends ConvexContext, TTarget extends ConvexRuntimeTarget = ConvexRuntimeTarget>(
    ctx: TCtx,
    target: TTarget | undefined,
    fn: () => R,
  ): R
  convexAgent<TPrompt extends Prompt<z.ZodType, z.ZodType | undefined, readonly ContextEntry[]>>(
    config: CruxConvexProfileAgentConfig<TPrompt>,
  ): CruxConvexAgent<TPrompt>
}

export interface CreateCruxConvexOptions {
  /**
   * The two Convex components the Crux profile needs.
   *
   * Keeping both under one `components` object avoids ambiguous lower-level
   * option names in public APIs.
   */
  components: CruxConvexComponents
  vectorIndexName?: string
  semanticCache?: ConvexMemoryStoreConfig['semanticCache']
  namespace?: ConvexCruxRuntime['namespace']
}

/**
 * Create a Convex runtime profile for Crux.
 *
 * The profile centralizes Convex component wiring once per app/module:
 * `store(ctx)` creates the Crux store, `withRuntime()` binds the request
 * runtime for low-level integrations, and `convexAgent()` builds the
 * high-level Convex Agent wrapper with prompt/memory/tool/skill plumbing.
 */
export function createCruxConvex(options: CreateCruxConvexOptions): CruxConvexProfile {
  return {
    components: options.components,
    store(ctx) {
      return cruxConvexStore({
        component: options.components.crux,
        ctx,
        vectorIndexName: options.vectorIndexName,
        semanticCache: options.semanticCache,
      })
    },
    withRuntime(ctx, target, fn) {
      return runWithConvexCruxRuntime(
        {
          ctx,
          component: options.components.crux,
          store: cruxConvexStore({
            component: options.components.crux,
            ctx,
            vectorIndexName: options.vectorIndexName,
            semanticCache: options.semanticCache,
          }),
          target,
          namespace: options.namespace,
        },
        fn,
      )
    },
    convexAgent(config) {
      return createConvexAgent({
        ...config,
        components: options.components,
        store: (ctx) =>
          cruxConvexStore({
            component: options.components.crux,
            ctx: ctx as ConvexContext,
            vectorIndexName: options.vectorIndexName,
            semanticCache: options.semanticCache,
          }),
      })
    },
  }
}
