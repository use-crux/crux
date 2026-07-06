/**
 * The shared {@link Retriever} entity factory.
 *
 * Wraps a `retrieve` function with the `asContext` / `asTools` / `inject`
 * adapters used by both store-backed and custom retrievers (and pipelines).
 *
 * @module
 */

import { z } from 'zod'
import { contextWithFamily, contextWithFullPromptInput } from '../prompt/context'
import type { AnyToolSet } from '../types'
import type { Context, ContextSystemContent, ContextTextSegment } from '../prompt/context-types'
import type { InternalPromptInjection } from '../prompt/internal-injection'
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

      return contextWithFullPromptInput({
        id: `retriever:${args.id}`,
        description: `Retriever context for ${args.id}`,
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
          const meta = { query, mode: args.mode, namespace: args.namespace }
          return renderContext === defaultRenderContext && hits.some(hasRetrieverHitFreshness)
            ? defaultRenderContextContent(hits, meta)
            : renderContext(hits, meta)
        },
      }, 'retriever')
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

    async inject({ input }: { input: Record<string, unknown>; promptId?: string }): Promise<InternalPromptInjection> {
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
        const meta = { query, mode: args.mode, namespace: args.namespace }
        const rendered = initialHits.length
          ? renderContext === defaultRenderContext && initialHits.some(hasRetrieverHitFreshness)
            ? defaultRenderContextContent(initialHits, meta)
            : renderContext(initialHits, meta)
          : ''
        contexts.push(
          contextWithFamily({
            id: `retriever:${args.id}`,
            description: `Retriever context for ${args.id}`,
            priority: args.defaultContext?.priority ?? 50,
            system: rendered,
          }, 'retriever'),
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

function defaultRenderContextContent(
  hits: RetrieverHit[],
  meta: { query: string; mode: RetrieverMode; namespace: string },
): ContextSystemContent {
  return {
    segments: [
      { text: `## Retrieved Context (${meta.query})\n`, dynamic: false },
      ...hits.map((hit, index) => ({
        text: `${index > 0 ? '\n' : ''}- [${hit.sourceId}/${hit.chunkId}] (score: ${hit.score.toFixed(2)}) ${hit.content}`,
        dynamic: true,
        source: `${meta.namespace}:${hit.sourceId}/${hit.chunkId}`,
        ...retrieverHitFreshness(hit),
      })),
    ],
  }
}

function retrieverHitFreshness(hit: RetrieverHit): Pick<ContextTextSegment, 'observedAt' | 'sourceVersion'> {
  return {
    ...(typeof hit.metadata.observedAt === 'number' ? { observedAt: hit.metadata.observedAt } : {}),
    ...(typeof hit.metadata.sourceVersion === 'string' ? { sourceVersion: hit.metadata.sourceVersion } : {}),
  }
}

function hasRetrieverHitFreshness(hit: RetrieverHit): boolean {
  return typeof hit.metadata.observedAt === 'number' || typeof hit.metadata.sourceVersion === 'string'
}
