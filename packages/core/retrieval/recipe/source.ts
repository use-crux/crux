/**
 * Source normalization for federated retrieval recipes.
 *
 * @module
 */

import { RetrievalConfigError } from '../errors'
import type { Retriever } from '../types'

/** A weighted source entry accepted by `retrievalRecipe()`. */
export interface RetrievalRecipeSource {
  retriever: Retriever
  weight?: number
}

/** Public source input accepted by `retrievalRecipe()`. */
export type RetrievalRecipeSourceInput =
  | Retriever
  | readonly [Retriever, ...Retriever[]]
  | readonly [RetrievalRecipeSource, ...RetrievalRecipeSource[]]

/** Normalized source used by the recipe runner. */
export interface NormalizedRecipeSource {
  retriever: Retriever
  weight: number
}

/** Normalize single-source and federated source config into weighted sources. */
export function normalizeRecipeSources(input: RetrievalRecipeSourceInput): readonly NormalizedRecipeSource[] {
  if (isRetriever(input)) {
    return [{ retriever: input, weight: 1 }]
  }
  return input.map((entry) => normalizeSourceEntry(entry))
}

function normalizeSourceEntry(entry: Retriever | RetrievalRecipeSource): NormalizedRecipeSource {
  const retriever = isSourceConfig(entry) ? entry.retriever : entry
  const weight = isSourceConfig(entry) ? (entry.weight ?? 1) : 1
  if (!Number.isFinite(weight) || weight <= 0) {
    throw new RetrievalConfigError('invalid_step_order', 'Retrieval source weight must be a positive number.')
  }
  return { retriever, weight }
}

function isRetriever(input: RetrievalRecipeSourceInput): input is Retriever {
  return !Array.isArray(input) && '_tag' in input && input._tag === 'Retriever'
}

function isSourceConfig(entry: Retriever | RetrievalRecipeSource): entry is RetrievalRecipeSource {
  return 'retriever' in entry
}
