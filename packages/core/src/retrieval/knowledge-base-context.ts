/**
 * Default prompt-context adapters for connected knowledge handles.
 *
 * @module
 */

import type { z } from 'zod'
import type { Context } from '../prompt/context-types'
import type { InternalPromptInjection } from '../prompt/internal-injection'
import type { Retriever, RetrieverHit, RetrieverMode } from './types'

/** Options for rendering a knowledge base or view as prompt context. */
export interface KnowledgeRetrievalContextOptions {
  priority?: number
  query?: string | ((input: Record<string, unknown>) => string)
  limit?: number
  renderContext?: (hits: RetrieverHit[], meta: { query: string; mode: RetrieverMode; namespace: string }) => string
  /** Attach retrieval tools to the context for representation planning. */
  tools?: boolean
}

/** Render a connected knowledge handle through its default retriever. */
export function knowledgeRetrievalContext(
  retriever: Retriever,
  options: KnowledgeRetrievalContextOptions = {},
): Context<z.ZodType<{}>> {
  return retriever.asContext({
    ...options,
    query: options.query ?? promptInputQuery,
  })
}

/** Inject the default retrieval context for a bare connected knowledge handle. */
export async function injectKnowledgeRetrievalContext(
  retriever: Retriever,
): Promise<InternalPromptInjection> {
  return { contexts: [knowledgeRetrievalContext(retriever)] }
}

const promptInputKeys = ['query', 'question', 'message', 'prompt'] as const

/** Read the default retrieval query from common prompt input fields. */
export function promptInputQuery(input: Record<string, unknown>): string {
  for (const key of promptInputKeys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  throw new Error(
    `Connected knowledge retrieval requires a string input field named ${promptInputKeys.map((key) => `"${key}"`).join(', ')}, or an explicit asContext({ query }) override.`,
  )
}
