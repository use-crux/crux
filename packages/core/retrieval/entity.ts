/**
 * The shared {@link Retriever} entity factory.
 *
 * Wraps a `retrieve` function with the `asContext` / `asTools` / `inject`
 * adapters used by both store-backed and custom retrievers (and pipelines).
 *
 * @module
 */

import { z } from 'zod'
import { context } from '../prompt/context'
import type { AnyToolSet } from '../types'
import type { Context, PromptInjection } from '../prompt/context-types'
import { createRetrieverTools } from './tools'
import { normalizeRetrieveRequest } from './request'
import type {
  RetrievalInjectMode,
  RetrievalToolConfig,
  Retriever,
  RetrieverContextConfig,
  RetrieverHit,
  RetrieverMode,
  RetrieverTools,
  RetrieveOptions,
} from './types'

/** Build a frozen {@link Retriever} from a bound `retrieve` and injection defaults. */
export function createRetrieverEntity(args: {
  id: string
  namespace: string
  mode: RetrieverMode
  retrieve: (query: string, options?: RetrieveOptions) => Promise<RetrieverHit[]>
  getSource?: (lookup: { namespace: string; sourceId: string; chunkId: string }) => Promise<RetrieverHit | null>
  defaultContext?: RetrieverContextConfig
  defaultInject?: RetrievalInjectMode
  defaultTools?: false | RetrievalToolConfig
}): Retriever {
  const retrieve: Retriever['retrieve'] = (queryOrRequest, options) => {
    const request = normalizeRetrieveRequest(queryOrRequest, options)
    const { query, ...retrieveOptions } = request
    return args.retrieve(query, retrieveOptions)
  }

  return Object.freeze({
    _tag: 'Retriever' as const,
    id: args.id,
    namespace: args.namespace,
    mode: args.mode,

    retrieve,

    asContext(options?: {
      priority?: number
      query?: string | ((input: Record<string, unknown>) => string)
      limit?: number
      renderContext?: (hits: RetrieverHit[], meta: { query: string; mode: RetrieverMode; namespace: string }) => string
    }): Context<z.ZodType<{}>> {
      const querySource = options?.query ?? args.defaultContext?.query
      const priority = options?.priority ?? args.defaultContext?.priority ?? 50
      const limit = options?.limit ?? args.defaultContext?.limit ?? 5
      const renderContext = options?.renderContext ?? args.defaultContext?.renderContext ?? defaultRenderContext

      return context({
        id: `retriever:${args.id}`,
        description: `Retriever context for ${args.id}`,
        family: 'retriever',
        priority,
        system: async ({ input }) => {
          const query = resolveQuery(querySource, input)
          if (!query) {
            throw new Error(
              `Retriever "${args.id}" asContext() requires a query via config.context.query or options.query.`,
            )
          }

          const hits = await retrieve(query, { limit })
          if (hits.length === 0) return ''
          return renderContext(hits, { query, mode: args.mode, namespace: args.namespace })
        },
      })
    },

    asTools<const TConfig extends RetrievalToolConfig | undefined = undefined>(
      options?: TConfig,
    ): RetrieverTools<TConfig> {
      return createRetrieverTools({
        id: args.id,
        namespace: args.namespace,
        retrieve,
        getSource: args.getSource,
        config: options,
      }) as RetrieverTools<TConfig>
    },

    async inject({ input }: { input: Record<string, unknown>; promptId?: string }): Promise<PromptInjection> {
      const injectMode = args.defaultInject ?? (args.defaultContext?.query ? 'context' : 'tool')
      const contexts: Context[] = []
      let tools: AnyToolSet | undefined
      let initialHits: RetrieverHit[] = []

      if (injectMode === 'context' || injectMode === 'both') {
        const query = resolveQuery(args.defaultContext?.query, input)
        if (!query) {
          throw new Error(`Retriever "${args.id}" inject:${injectMode} requires context.query.`)
        }
        initialHits = await retrieve(query, { limit: args.defaultContext?.limit })
        const renderContext = args.defaultContext?.renderContext ?? defaultRenderContext
        const rendered = initialHits.length
          ? renderContext(initialHits, { query, mode: args.mode, namespace: args.namespace })
          : ''
        contexts.push(
          context({
            id: `retriever:${args.id}`,
            description: `Retriever context for ${args.id}`,
            family: 'retriever',
            priority: args.defaultContext?.priority ?? 50,
            system: rendered,
          }),
        )
      }

      if (injectMode === 'tool' || injectMode === 'both') {
        const toolConfig = args.defaultTools === false ? { enabled: false } : args.defaultTools
        if (toolConfig?.enabled !== false) {
          tools = createRetrieverTools({
            id: args.id,
            namespace: args.namespace,
            retrieve,
            getSource: args.getSource,
            config: { ...(toolConfig ?? {}), initialHits },
          })
        }
      }

      return {
        ...(contexts.length ? { contexts } : {}),
        ...(tools && Object.keys(tools).length > 0 ? { tools } : {}),
      }
    },
  })
}

function resolveQuery(
  query: string | ((input: Record<string, unknown>) => string) | undefined,
  input: Record<string, unknown>,
): string | undefined {
  if (!query) return undefined
  return typeof query === 'function' ? query(input) : query
}

function defaultRenderContext(
  hits: RetrieverHit[],
  meta: { query: string; mode: RetrieverMode; namespace: string },
): string {
  const lines = hits.map((hit) => `- [${hit.sourceId}/${hit.chunkId}] (score: ${hit.score.toFixed(2)}) ${hit.content}`)
  return `## Retrieved Context (${meta.query})\n${lines.join('\n')}`
}
