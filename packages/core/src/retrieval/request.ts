/** Canonical text-or-media retrieval request normalization. @module */

import type { EmbeddingInput, EmbeddingModality } from '../embedding'
import type { ExactFilter, FilterValue } from '../storage'

/** Metadata filter inferred from a schema, restricted to exact scalar values. */
export type MetadataFilter<TMetadata extends object> = {
  readonly [K in Extract<keyof TMetadata, string> as Extract<TMetadata[K], FilterValue> extends never
    ? never
    : K]?: Extract<TMetadata[K], FilterValue>
}

/** Options shared by text and media retrieval requests. */
export interface RetrieveOptions<TFilter extends ExactFilter = ExactFilter> {
  /** Maximum number of hits to return. */
  limit?: number
  /** Minimum similarity score accepted by the configured vector store. */
  threshold?: number
  /** Exact metadata constraints applied before vector scoring. */
  filter?: TFilter
  /** Search leg override for this request. */
  mode?: 'dense' | 'sparse' | 'hybrid'
  /** Query-fusion settings used by hybrid search and retrieval recipes. */
  fusion?: { strategy: 'rrf'; k?: number }
  /** Whether a caller wants the enclosing primitive to retain a recipe trace. */
  trace?: boolean
  /** Opaque caller attribution forwarded to retrieval recipes. */
  caller?: Record<string, unknown>
}

/**
 * Structured retrieval request containing exactly one text query or embedding input.
 *
 * A string passed directly to `retrieve()` is always a text query. Use `input`
 * for typed text/media inputs or pass a bare media `Asset` directly.
 */
export type RetrieveRequest<
  TFilter extends ExactFilter = ExactFilter,
  TModality extends EmbeddingModality = EmbeddingModality,
> = RetrieveOptions<TFilter> & (
  | ('text' extends TModality ? { query: string; input?: never } : never)
  | { query?: never; input: EmbeddingInput<TModality> }
)

/** Public first argument accepted by retrievers and retrieval recipes. */
export type RetrieveInput<
  TFilter extends ExactFilter = ExactFilter,
  TModality extends EmbeddingModality = EmbeddingModality,
> = EmbeddingInput<TModality> | RetrieveRequest<TFilter, TModality>

/** Normalize text, media, or structured input to the canonical XOR request. */
export function normalizeRetrieveRequest<
  TFilter extends ExactFilter = ExactFilter,
  TModality extends EmbeddingModality = EmbeddingModality,
>(
  queryOrRequest: RetrieveInput<TFilter, TModality>,
  options: RetrieveOptions<TFilter> = {},
): RetrieveRequest<TFilter, TModality> {
  if (typeof queryOrRequest === 'string') {
    return { ...options, query: queryOrRequest } as RetrieveRequest<TFilter, TModality>
  }
  if ('type' in queryOrRequest) {
    return { ...options, input: queryOrRequest } as RetrieveRequest<TFilter, TModality>
  }

  const hasQuery = typeof queryOrRequest.query === 'string'
  const hasInput = queryOrRequest.input !== undefined
  if (hasQuery === hasInput) {
    throw new TypeError('RetrieveRequest must provide exactly one of query or input.')
  }
  return queryOrRequest
}

/** Remove the query/input discriminant after it has been prepared for execution. */
export function retrieveOptions<
  TFilter extends ExactFilter,
  TModality extends EmbeddingModality,
>(
  request: RetrieveRequest<TFilter, TModality>,
): RetrieveOptions<TFilter> {
  const { query: _query, input: _input, ...options } = request
  return options
}
