/**
 * Retrieval-backed grounding for prompts.
 *
 * {@link grounding} builds a {@link Grounding} injectable that retrieves hits
 * for a query, injects them as context and/or retrieval tools, and attaches a
 * citation constraint so generated claims must cite the retrieved sources.
 * {@link renderCitationContext} renders retrieved hits into a grounded-sources
 * context block.
 *
 * @module
 */

import { context } from '../prompt/context'
import { createRetrieverTools, isRetrievalToolPayload } from '../retrieval/tools'
import type { RetrievalToolHit } from '../retrieval/tools'
import type { RetrieverHit } from '../retrieval'
import { toolMiddleware } from '../tools/middleware'
import type { PromptInjection } from '../prompt/context-types'
import { citationConstraint } from './constraint'
import { createGroundingSession } from './session'
import type { Grounding, GroundingConfig, GroundingResolution } from './types'

/**
 * Create a {@link Grounding} injectable from a retriever and query.
 *
 * Depending on `config.inject` (`'context'`, `'tool'`, or `'both'`), the
 * grounding injects rendered context, retrieval tools, or both, and — unless
 * disabled — adds a {@link citationConstraint} that requires output to cite the
 * retrieved hits.
 *
 * @param config - Retriever, query, inject mode, rendering, and citation policy.
 * @returns A frozen grounding injectable.
 *
 * @example
 * ```ts
 * const grounded = grounding({ id: 'docs', retriever, query: (a) => a.input.q })
 * const p = prompt({ id: 'qa', use: [grounded], ... })
 * ```
 */
export function grounding(config: GroundingConfig): Grounding {
  if (!config.id.trim()) {
    throw new Error('grounding(): id must be non-empty.')
  }
  const injectMode = config.inject ?? 'context'
  if ((injectMode === 'context' || injectMode === 'both') && !config.query) {
    throw new Error('grounding(): query is required when injecting context.')
  }

  return Object.freeze({
    _tag: 'Grounding' as const,
    id: config.id,
    retriever: config.retriever,
    async inject({ input }: { input: Record<string, unknown>; promptId?: string }): Promise<PromptInjection> {
      const query = config.query ? resolveGroundingQuery(config.query, input) : undefined
      const session = createGroundingSession()
      let initialHits: RetrieverHit[] = []
      const contexts = []
      let tools: PromptInjection['tools']

      if (injectMode === 'context' || injectMode === 'both') {
        if (!query) {
          throw new Error('grounding(): query is required when injecting context.')
        }
        initialHits = await retrieveGroundingHits(config, query, input)
        await session.recordHits(initialHits, 'injected')
        const rendered =
          (await config.render?.({ hits: initialHits, query, input, retriever: config.retriever })) ??
          renderCitationContext(initialHits)
        if (rendered) {
          contexts.push(
            context({
              id: `grounding:${config.id}`,
              description: `Grounding context for ${config.id}`,
              family: 'retriever',
              system: rendered,
            }),
          )
        }
      }

      if (injectMode === 'tool' || injectMode === 'both') {
        const toolConfig = config.tools === false ? { enabled: false } : config.tools
        if (toolConfig?.enabled !== false) {
          tools = createRetrieverTools({
            id: config.retriever.id,
            namespace: config.retriever.namespace,
            retrieve: config.retriever.retrieve,
            session,
            config: {
              ...(toolConfig ?? {}),
              prefix: toolConfig?.prefix === undefined || toolConfig.prefix === true ? config.id : toolConfig.prefix,
              initialHits,
            },
          })
        }
      }

      const citations = config.citations
      const required = citations?.required ?? true
      const constraints =
        required || citations
          ? [
              citationConstraint({
                session,
                required,
                quotes: citations?.quotes ?? (required ? 'required' : 'optional'),
                groundingId: config.id,
                retrieverId: config.retriever.id,
                ...(query ? { query } : {}),
                select: citations?.select,
              }),
            ]
          : []

      return {
        ...(contexts.length ? { contexts } : {}),
        ...(tools && Object.keys(tools).length > 0 ? { tools } : {}),
        ...(tools && Object.keys(tools).length > 0
          ? { toolMiddleware: createGroundingToolMiddleware(config.id, session) }
          : {}),
        ...(constraints.length ? { constraints } : {}),
        metadata: {
          grounding: {
            groundingId: config.id,
            retrieverId: config.retriever.id,
            ...(query ? { query } : {}),
            allowedHits: (await session.allowedHits()).map((hit) => ({
              namespace: hit.namespace,
              sourceId: hit.sourceId,
              chunkId: hit.chunkId,
              score: hit.score,
            })),
          },
        },
      }
    },
    async resolve(input: Record<string, unknown>): Promise<GroundingResolution> {
      if (!config.query) {
        return {
          groundingId: config.id,
          retrieverId: config.retriever.id,
          hits: [],
        }
      }
      const query = resolveGroundingQuery(config.query, input)
      const hits = await retrieveGroundingHits(config, query, input)
      return {
        groundingId: config.id,
        retrieverId: config.retriever.id,
        query,
        hits,
      }
    },
  })
}

/**
 * Render retrieved hits into a "Grounded Sources" context block.
 *
 * @param hits - The retrieved hits to render.
 * @param options - Optional title and per-hit content truncation length.
 * @returns A markdown string, or `''` when there are no hits.
 */
export function renderCitationContext(
  hits: readonly RetrieverHit[],
  options: {
    title?: string
    maxContentChars?: number
  } = {},
): string {
  if (hits.length === 0) return ''
  const title = options.title ?? 'Grounded Sources'
  const maxContentChars = options.maxContentChars ?? 4_000
  const lines = [`## ${title}`, 'Use only these retrieved sources for grounded claims. Cite with sourceId and chunkId.']

  for (const hit of hits) {
    lines.push('')
    lines.push(`Source: ${hit.namespace}/${hit.sourceId}/${hit.chunkId}`)
    if (hit.sourceUrl) lines.push(`URL: ${hit.sourceUrl}`)
    if (hit.sourcePath) lines.push(`Path: ${hit.sourcePath}`)
    lines.push(`Score: ${hit.score}`)
    lines.push(hit.content.slice(0, maxContentChars))
  }

  return lines.join('\n')
}

/** Retrieve hits for a grounding query, applying its optional `select` filter. */
async function retrieveGroundingHits(
  config: GroundingConfig,
  query: string,
  input: Record<string, unknown>,
): Promise<RetrieverHit[]> {
  const hits = await config.retriever.retrieve(query, { limit: config.limit })
  return config.select ? config.select({ hits, query, input, retriever: config.retriever }) : hits
}

/** Resolve a static or function grounding query to a non-empty string. */
function resolveGroundingQuery(
  query: string | ((args: { input: Record<string, unknown> }) => string),
  input: Record<string, unknown>,
): string {
  const resolved = typeof query === 'function' ? query({ input }) : query
  if (!resolved.trim()) {
    throw new Error('grounding(): query must resolve to a non-empty string.')
  }
  return resolved
}

function createGroundingToolMiddleware(
  groundingId: string,
  session: ReturnType<typeof createGroundingSession>,
): ReturnType<typeof toolMiddleware> {
  return toolMiddleware({
    id: `grounding:${groundingId}:retrieval-evidence`,
    afterExecute: async ({ output }) => {
      if (!isRetrievalToolPayload(output)) return
      await session.recordHits(output.hits.map(toolHitToRetrieverHit), 'tool')
    },
  })
}

function toolHitToRetrieverHit(hit: RetrievalToolHit): RetrieverHit {
  return {
    namespace: hit.namespace,
    sourceId: hit.sourceId,
    chunkId: hit.chunkId,
    content: hit.content,
    metadata: {},
    score: hit.score,
    ...(hit.sourceUrl ? { sourceUrl: hit.sourceUrl } : {}),
  }
}
