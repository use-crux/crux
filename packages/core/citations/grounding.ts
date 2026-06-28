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
import type { RetrieverHit } from '../retrieval'
import type { PromptInjection } from '../prompt/context-types'
import { citationConstraint } from './constraint'
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

  return Object.freeze({
    _tag: 'Grounding' as const,
    id: config.id,
    retriever: config.retriever,
    async inject({ input }: { input: Record<string, unknown>; promptId?: string }): Promise<PromptInjection> {
      const query = resolveGroundingQuery(config.query, input)
      const allowedHits: RetrieverHit[] = []
      const contexts = []
      let tools: PromptInjection['tools']

      if (injectMode === 'context' || injectMode === 'both') {
        allowedHits.push(...(await retrieveGroundingHits(config, query, input)))
        const rendered =
          (await config.render?.({ hits: allowedHits, query, input, retriever: config.retriever })) ??
          renderCitationContext(allowedHits)
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
          tools = config.retriever.asTools({
            ...(toolConfig ?? {}),
            prefix: toolConfig?.prefix === undefined || toolConfig.prefix === true ? config.id : toolConfig.prefix,
            initialHits: allowedHits,
          })
          wrapSearchToolsForGrounding(tools, allowedHits)
        }
      }

      const citations = config.citations
      const required = citations?.required ?? true
      const constraints =
        required || citations
          ? [
              citationConstraint({
                hits: allowedHits,
                required,
                quotes: citations?.quotes ?? (required ? 'required' : 'optional'),
                groundingId: config.id,
                retrieverId: config.retriever.id,
                query,
                select: citations?.select,
              }),
            ]
          : []

      return {
        ...(contexts.length ? { contexts } : {}),
        ...(tools && Object.keys(tools).length > 0 ? { tools } : {}),
        ...(constraints.length ? { constraints } : {}),
        metadata: {
          grounding: {
            groundingId: config.id,
            retrieverId: config.retriever.id,
            query,
            allowedHits: allowedHits.map((hit) => ({
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

/**
 * Wrap retrieval search tools so their JSON results feed the allowed-hits set.
 *
 * Lets citation validation learn additional allowed hits discovered via tool
 * calls during generation. Non-JSON tool output is passed through unchanged.
 */
function wrapSearchToolsForGrounding(tools: NonNullable<PromptInjection['tools']>, allowedHits: RetrieverHit[]): void {
  for (const tool of Object.values(tools) as Array<{ execute?: unknown }>) {
    if (typeof tool.execute !== 'function') continue
    const original = tool.execute
    tool.execute = async (args: unknown) => {
      const result = await original(args)
      if (typeof result === 'string') {
        try {
          const parsed = JSON.parse(result)
          if (Array.isArray(parsed)) {
            allowedHits.push(...parsed.filter(isRetrieverHitLike))
          }
        } catch {
          // Tool output is still returned to the model; citation validation just
          // cannot learn additional allowed hits from non-JSON output.
        }
      }
      return result
    }
  }
}

/** Structural type guard for a retriever hit parsed from tool JSON output. */
function isRetrieverHitLike(value: unknown): value is RetrieverHit {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RetrieverHit>
  return (
    typeof candidate.namespace === 'string' &&
    typeof candidate.sourceId === 'string' &&
    typeof candidate.chunkId === 'string' &&
    typeof candidate.content === 'string' &&
    typeof candidate.score === 'number' &&
    typeof candidate.metadata === 'object' &&
    candidate.metadata !== null
  )
}
