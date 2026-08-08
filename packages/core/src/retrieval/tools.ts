/**
 * Generated retriever tools (`search` and `getSource`).
 *
 * `search` runs the retriever and returns a typed, transcript-safe payload.
 * Tool names may be prefixed from the retriever id or an explicit prefix.
 *
 * @module
 */

import { z } from 'zod'
import type { ToolDef } from '../types/tool'
import type { ExactFilter } from '../storage'
import type { FindingCitation, RetrievalToolConfig, RetrievalToolName, Retriever, RetrieverHit, RetrieverSource } from './types'
import type { StoredEvidence } from '../indexing'
import { normalizeRetrieverSource } from './source'

/** Discriminator for typed retrieval tool results. */
export const RETRIEVAL_HITS_KIND = 'crux.retrieval.hits' as const

/** Lean retrieval hit exposed through typed tool results. */
export interface RetrievalEvidenceToolHit {
  readonly kind?: 'evidence'
  namespace: string
  readonly source: RetrieverSource
  chunkId: string
  content: string
  score: number
  /** Immutable evidence retained so tool-grounded results remain citation-capable. */
  evidence: StoredEvidence
}

/** Lean finding hit exposed through typed tool results. */
export interface RetrievalFindingToolHit {
  readonly kind: 'finding'
  readonly namespace: string
  readonly content: string
  readonly score: number
  readonly citation: FindingCitation
}

/** Lean retrieval hit exposed through typed tool results. */
export type RetrievalToolHit = RetrievalEvidenceToolHit | RetrievalFindingToolHit

/** Structured payload returned by retrieval search tools. */
export interface RetrievalToolPayload {
  kind: typeof RETRIEVAL_HITS_KIND
  hits: RetrievalToolHit[]
}

/** Tool definition whose execution returns a typed retrieval payload. */
export type RetrievalToolDef = ToolDef<Record<string, unknown>, unknown> & {
  execute(args: Record<string, unknown>): Promise<RetrievalToolPayload>
}

interface ToolGroundingSession {
  allowedHits(): readonly RetrieverHit[] | Promise<readonly RetrieverHit[]>
}

interface SourceLookup {
  namespace: string
  sourceId: string
  chunkId: string
}

/** Build the retriever tool set for the given config. */
export function createRetrieverTools(args: {
  id: string
  namespace: string
  retrieve: Retriever['retrieve']
  config?: RetrievalToolConfig & { initialHits?: readonly RetrieverHit[] }
  session?: ToolGroundingSession
  getSource?: (lookup: SourceLookup) => Promise<RetrieverHit | null>
}): Record<string, RetrievalToolDef> {
  const include = new Set<RetrievalToolName>(args.config?.include ?? ['search'])
  const prefix = resolveToolPrefix(args.id, args.config?.prefix)
  const searchParameters = z.object({
    query: z.string().min(1).describe('Natural-language search query.'),
    limit: z.number().int().positive().optional().describe('Maximum number of hits to return.'),
    threshold: z.number().optional().describe('Minimum similarity threshold.'),
    filter: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  })

  const tools: Record<string, RetrievalToolDef> = {}
  if (include.has('search')) {
    tools[toolName(prefix, 'search')] = {
      description: `Search the "${args.namespace}" knowledge base through retriever "${args.id}". Returns scored chunks with source and chunk IDs.`,
      parameters: searchParameters,
      async execute(rawArgs: Record<string, unknown>): Promise<RetrievalToolPayload> {
        const parsed = searchParameters.parse(rawArgs)
        const hits = await args.retrieve(parsed.query, {
          limit: resolveLimit(parsed.limit, args.config),
          threshold: resolveThreshold(parsed.threshold, args.config),
          filter: resolveFilter(parsed.filter, args.config),
        })
        return {
          kind: RETRIEVAL_HITS_KIND,
          hits: hits.map(toToolHit),
        }
      },
      toModelOutput: ({ output }: { output: unknown }) => ({
        type: 'text',
        value: isRetrievalToolPayload(output) ? renderRetrievalToolPayload(output) : '',
      }),
    } satisfies RetrievalToolDef
  }

  if (include.has('getSource')) {
    tools[toolName(prefix, 'getSource')] = {
      description: `Return an active source chunk from "${args.namespace}" when this retriever can read indexed knowledge by source id.`,
      parameters: z.object({
        namespace: z.string().optional(),
        sourceId: z.string().min(1),
        chunkId: z.string().min(1),
      }),
      async execute(rawArgs: Record<string, unknown>): Promise<RetrievalToolPayload> {
        const parsed = z
          .object({
            namespace: z.string().optional(),
            sourceId: z.string().min(1),
            chunkId: z.string().min(1),
          })
          .parse(rawArgs)
        const lookup = {
          namespace: parsed.namespace ?? args.namespace,
          sourceId: parsed.sourceId,
          chunkId: parsed.chunkId,
        }
        const visibility = args.config?.getSource?.visibility ?? 'discovered'
        const hit =
          visibility === 'discovered'
            ? await getDiscoveredSource(lookup, args.session)
            : await getNamespaceSource(lookup, args.getSource)
        return {
          kind: RETRIEVAL_HITS_KIND,
          hits: [toToolHit(hit)],
        }
      },
      toModelOutput: ({ output }: { output: unknown }) => ({
        type: 'text',
        value: isRetrievalToolPayload(output) ? renderRetrievalToolPayload(output) : '',
      }),
    } satisfies RetrievalToolDef
  }

  return tools
}

async function getDiscoveredSource(
  lookup: SourceLookup,
  session: ToolGroundingSession | undefined,
): Promise<RetrieverHit> {
  if (!session) {
    throw new Error('getSource requires a store-backed retriever or grounding session.')
  }
  const hit = (await session.allowedHits()).find(
    (candidate) =>
      candidate.kind !== 'finding' &&
      candidate.namespace === lookup.namespace &&
      candidate.source.id === lookup.sourceId &&
      candidate.chunkId === lookup.chunkId,
  )
  if (!hit) {
    throw new Error(`Source ${lookup.namespace}:${lookup.sourceId}:${lookup.chunkId} has not been discovered.`)
  }
  return hit
}

async function getNamespaceSource(
  lookup: SourceLookup,
  getSource: ((lookup: SourceLookup) => Promise<RetrieverHit | null>) | undefined,
): Promise<RetrieverHit> {
  if (!getSource) {
    throw new Error('getSource namespace visibility requires a store-backed retriever.')
  }
  const hit = await getSource(lookup)
  if (!hit) {
    throw new Error(`Source ${lookup.namespace}:${lookup.sourceId}:${lookup.chunkId} is not active or does not exist.`)
  }
  return hit
}

function resolveLimit(limit: number | undefined, config: RetrievalToolConfig | undefined): number | undefined {
  const resolved = limit ?? config?.limit?.default
  const max = config?.limit?.max
  if (resolved !== undefined && max !== undefined && resolved > max) {
    throw new Error(`Retrieval tool limit ${resolved} exceeds the configured maximum ${max}.`)
  }
  return resolved
}

function resolveThreshold(
  threshold: number | undefined,
  config: RetrievalToolConfig | undefined,
): number | undefined {
  const resolved = threshold ?? config?.threshold?.default
  const min = config?.threshold?.min
  if (resolved !== undefined && min !== undefined && resolved < min) {
    throw new Error(`Retrieval tool threshold ${resolved} is below the configured minimum ${min}.`)
  }
  return resolved
}

function resolveFilter(
  filter: ExactFilter | undefined,
  config: RetrievalToolConfig | undefined,
): ExactFilter | undefined {
  if (!filter) return undefined
  const allowlist = config?.filters
  if (!allowlist) return filter
  const allowed = new Set(allowlist)
  const disallowed = Object.keys(filter).filter((key) => !allowed.has(key))
  if (disallowed.length > 0) {
    throw new Error(`Retrieval tool filter keys are not allowlisted: ${disallowed.join(', ')}.`)
  }
  return filter
}

/** Return true when a value is a retrieval search tool payload. */
export function isRetrievalToolPayload(value: unknown): value is RetrievalToolPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === RETRIEVAL_HITS_KIND &&
    Array.isArray((value as { hits?: unknown }).hits)
  )
}

function toolName(prefix: string, base: RetrievalToolName): string {
  return prefix ? `${prefix}${base[0].toUpperCase()}${base.slice(1)}` : base
}

function resolveToolPrefix(id: string, prefix: boolean | string | undefined): string {
  if (prefix === true) return `${toToolPrefix(id)}`
  if (typeof prefix === 'string') return `${toToolPrefix(prefix)}`
  return ''
}

function toToolPrefix(value: string): string {
  const words = value.split(/[^a-zA-Z0-9]+/).filter(Boolean)
  if (words.length === 0) return ''
  return words
    .map((word, index) => {
      const lower = word.toLowerCase()
      return index === 0 ? lower : lower[0].toUpperCase() + lower.slice(1)
    })
    .join('')
}

function toToolHit(hit: RetrieverHit): RetrievalToolHit {
  if (hit.kind === 'finding') {
    return {
      kind: 'finding',
      namespace: hit.namespace,
      content: hit.content,
      score: hit.score,
      citation: hit.citation,
    }
  }
  return {
    namespace: hit.namespace,
    source: normalizeRetrieverSource(hit.source),
    chunkId: hit.chunkId,
    content: hit.content,
    score: hit.score,
    evidence: hit.evidence,
  }
}

function renderRetrievalToolPayload(payload: RetrievalToolPayload): string {
  return payload.hits
    .map((hit) => hit.kind === 'finding'
      ? `[${hit.citation.findingTarget}] (${formatScore(hit.score)}) ${hit.content}`
      : `[${hit.source.id}/${hit.chunkId}] (${formatScore(hit.score)}) ${hit.content}`)
    .join('\n')
}

function formatScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}
