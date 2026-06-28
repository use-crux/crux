/**
 * Generated retriever tools (`search` and `getSource`).
 *
 * `search` runs the retriever and remembers returned hits; `getSource` returns
 * a previously retrieved hit by id. Tool names may be prefixed from the
 * retriever id or an explicit prefix.
 *
 * @module
 */

import { z } from 'zod'
import type { ToolDef } from '../types/tool'
import type { RetrievalToolConfig, RetrievalToolName, Retriever, RetrieverHit } from './types'

/** Build the retriever tool set for the given config. */
export function createRetrieverTools(args: {
  id: string
  namespace: string
  retrieve: Retriever['retrieve']
  config?: RetrievalToolConfig & { initialHits?: readonly RetrieverHit[] }
}): Record<string, ToolDef> {
  const include = new Set<RetrievalToolName>(args.config?.include ?? ['search'])
  const prefix = resolveToolPrefix(args.id, args.config?.prefix)
  const seenHits = new Map<string, RetrieverHit>()
  for (const hit of args.config?.initialHits ?? []) {
    seenHits.set(toolHitKey(hit), hit)
  }

  const tools: Record<string, ToolDef> = {}
  if (include.has('search')) {
    tools[toolName(prefix, 'search')] = {
      description: `Search the "${args.namespace}" knowledge base through retriever "${args.id}". Returns scored chunks with source and chunk IDs.`,
      parameters: z.object({
        query: z.string().min(1).describe('Natural-language search query.'),
        limit: z.number().int().positive().optional().describe('Maximum number of hits to return.'),
        threshold: z.number().optional().describe('Minimum similarity threshold.'),
      }),
      async execute(rawArgs: Record<string, unknown>): Promise<string> {
        const parsed = z
          .object({
            query: z.string().min(1),
            limit: z.number().int().positive().optional(),
            threshold: z.number().optional(),
          })
          .parse(rawArgs)
        const hits = await args.retrieve(parsed.query, { limit: parsed.limit, threshold: parsed.threshold })
        for (const hit of hits) {
          seenHits.set(toolHitKey(hit), hit)
        }
        return JSON.stringify(hits)
      },
    }
  }

  if (include.has('getSource')) {
    tools[toolName(prefix, 'getSource')] = {
      description: `Return a previously retrieved source chunk from "${args.namespace}". Call search first if the source is not already in context.`,
      parameters: z.object({
        namespace: z.string().optional(),
        sourceId: z.string().min(1),
        chunkId: z.string().min(1),
      }),
      async execute(rawArgs: Record<string, unknown>): Promise<string> {
        const parsed = z
          .object({
            namespace: z.string().optional(),
            sourceId: z.string().min(1),
            chunkId: z.string().min(1),
          })
          .parse(rawArgs)
        const key = `${parsed.namespace ?? args.namespace}:${parsed.sourceId}:${parsed.chunkId}`
        const hit = seenHits.get(key)
        if (!hit) {
          throw new Error(`Source ${key} has not been retrieved yet. Call ${toolName(prefix, 'search')} first.`)
        }
        return JSON.stringify(hit)
      },
    }
  }

  return tools
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

function toolHitKey(hit: Pick<RetrieverHit, 'namespace' | 'sourceId' | 'chunkId'>): string {
  return `${hit.namespace}:${hit.sourceId}:${hit.chunkId}`
}
