/**
 * Canonical retrieval request normalization.
 *
 * Public retrievers accept either a query string plus options or a structured
 * request object. Internals consume the structured shape.
 *
 * @module
 */

import type { ExactFilter, FilterValue } from '../storage'

/** Metadata filter inferred from a schema, restricted to exact scalar values. */
export type MetadataFilter<TMetadata extends object> = {
  readonly [K in Extract<keyof TMetadata, string> as Extract<TMetadata[K], FilterValue> extends never
    ? never
    : K]?: Extract<TMetadata[K], FilterValue>
}

/** Canonical retrieval request. */
export interface RetrieveRequest<TFilter extends ExactFilter = ExactFilter> {
  query: string
  limit?: number
  threshold?: number
  filter?: TFilter
  mode?: 'dense' | 'sparse' | 'hybrid'
  fusion?: { strategy: 'rrf'; k?: number }
  trace?: boolean
  caller?: Record<string, unknown>
}

/** Options accepted beside a query string. */
export type RetrieveOptions<TFilter extends ExactFilter = ExactFilter> = Omit<RetrieveRequest<TFilter>, 'query'>

/** Normalize string-or-object retriever input to the canonical request shape. */
export function normalizeRetrieveRequest<TFilter extends ExactFilter = ExactFilter>(
  queryOrRequest: string | RetrieveRequest<TFilter>,
  options: RetrieveOptions<TFilter> = {},
): RetrieveRequest<TFilter> {
  return typeof queryOrRequest === 'string' ? { ...options, query: queryOrRequest } : queryOrRequest
}
