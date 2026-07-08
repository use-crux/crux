/**
 * Config validation and query/scope resolution for the semantic cache.
 *
 * Validates the cache config + store capabilities, normalizes the per-prompt
 * cache hint, resolves the scope key and the embedding query text, and provides
 * the stable hash used for scope/query keys. Internal helpers.
 *
 * @module
 */

import { StorageError } from '../storage'
import type { RecordStore, VectorStore } from '../storage'
import type { PromptMiddlewareArgs } from '../runtime/types'
import type { SemanticCachePromptOptions, SemanticCacheQueryContext } from '../prompt/prompt-types'
import type { NormalizedPromptHint, SemanticCacheConfig, SemanticCacheScopeContext } from './types'
import { contentText } from '../content'
import { isMessageContent } from '../content/guards'

/** Default cache namespace when none is configured. */
export const DEFAULT_NAMESPACE = 'default'
/** Default cache entry version. */
export const DEFAULT_VERSION = 'v1'
/** Default cosine similarity threshold for a cache hit. */
export const DEFAULT_THRESHOLD = 0.95

/** Validate cache config invariants (dense embedding, positive ttl). */
export function validateConfig(config: SemanticCacheConfig): void {
  if (config.embedding.kind !== 'dense') {
    throw new Error(
      'createSemanticCache() requires a dense embedding. Sparse and hybrid cache lookup are out of scope.',
    )
  }
  if (!Number.isFinite(config.ttl) || config.ttl <= 0) {
    throw new Error('createSemanticCache() requires ttl to be greater than 0.')
  }
}

/** Resolve and validate the beta storage ports used by semantic cache. */
export function resolveSemanticCacheStores(config: SemanticCacheConfig): {
  readonly records: RecordStore
  readonly vectors: VectorStore
} {
  const records = config.records ?? config.storage?.records
  const vectors = config.vectors ?? config.storage?.vectors
  if (!records) {
    throw new Error('createSemanticCache() requires records or storage.records.')
  }
  if (!vectors) {
    throw new Error('createSemanticCache() requires vectors or storage.vectors.')
  }
  if (records.capabilities().ttl === false) {
    throw new StorageError('ttl_unsupported', 'createSemanticCache() requires a record store with TTL support.')
  }
  if (vectors.capabilities().filter !== 'pre') {
    throw new StorageError(
      'unsupported_capability',
      'createSemanticCache() requires a vector store with pre-filter support.',
    )
  }
  return { records, vectors }
}

/** Normalize the per-prompt `cache.semantic` hint to a {@link NormalizedPromptHint}. */
export function normalizePromptHint(value: unknown): NormalizedPromptHint | null {
  if (value === undefined || value === false) return null
  if (value === true) return { mode: 'readwrite', version: DEFAULT_VERSION }
  const options = value as SemanticCachePromptOptions
  return {
    mode: options.mode ?? 'readwrite',
    version: options.version ?? DEFAULT_VERSION,
    ttl: options.ttl,
    threshold: options.threshold,
    query: options.query,
  }
}

/** Resolve the configured scope to a non-empty scope key. */
export async function resolveScope(
  scope: SemanticCacheConfig['scope'],
  ctx: SemanticCacheScopeContext,
): Promise<string> {
  if (scope === 'global') return 'global'
  const value = await scope(ctx)
  if (!value) throw new Error('createSemanticCache() scope resolved to an empty value.')
  return value
}

/** Resolve the embedding query text from the prompt hint or resolved prompt. */
export async function resolveQueryText(hint: NormalizedPromptHint, args: PromptMiddlewareArgs): Promise<string> {
  const resolved = args.resolved
  if (hint.query && resolved) {
    const preparedInput: Record<string, unknown> = isRecord(args.preparedArgs?.input) ? args.preparedArgs.input : {}
    const ctx: SemanticCacheQueryContext = {
      promptId: args.promptId,
      input: args.input ?? preparedInput,
      resolved,
      preparedArgs: args.preparedArgs ?? {},
      operation: args.operation ?? 'generate',
    }
    return hint.query(ctx)
  }
  if (resolved?.messages) {
    return resolved.messages
      .map((message) => {
        const role = String(message.role)
        const content = projectUnknownContent(message.content)
        return `${role}: ${content}`
      })
      .join('\n')
  }
  return [resolved?.system, resolved?.prompt, fallbackPreparedText(args)].filter(Boolean).join('\n\n')
}

/** Build a fallback query text from prepared args when no resolved prompt exists. */
function fallbackPreparedText(args: PromptMiddlewareArgs): string {
  const prepared: Record<string, unknown> = args.preparedArgs ?? {}
  if (Array.isArray(prepared.messages)) {
    return prepared.messages
      .map((message) => {
        const m = message as { role?: unknown; content?: unknown }
        const role = String(m.role ?? '')
        const content = projectUnknownContent(m.content)
        return `${role}: ${content}`
      })
      .join('\n')
  }
  if (typeof prepared.prompt === 'string') return prepared.prompt
  return JSON.stringify(args.input ?? prepared.input ?? {})
}

function projectUnknownContent(content: unknown): string {
  if (content === undefined || content === null) return ''
  return isMessageContent(content) ? contentText(content) : String(content)
}

/** Whether the call carries any tools (array or record form). */
export function hasTools(args: PromptMiddlewareArgs): boolean {
  const tools = args.preparedArgs?.tools
  if (Array.isArray(tools)) return tools.length > 0
  if (tools && typeof tools === 'object') return Object.keys(tools).length > 0
  return false
}

/** Narrow an unknown value to a plain (non-array) record. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Stable djb2-xor hash, base-36 encoded, for scope/query keys. */
export function hashStable(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  let hash = 5381
  for (let index = 0; index < text.length; index++) {
    hash = (hash * 33) ^ text.charCodeAt(index)
  }
  return (hash >>> 0).toString(36)
}
