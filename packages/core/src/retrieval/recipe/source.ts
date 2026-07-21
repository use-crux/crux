/**
 * Source normalization for federated retrieval recipes.
 *
 * @module
 */

import { RetrievalConfigError } from '../errors'
import type { EmbeddingModality } from '../../embedding'
import type { ExactFilter } from '../../storage'
import type { RetrieveInput, Retriever, RetrieverHit } from '../types'

/** Existential retriever shape accepted before recipe capability normalization. */
type RecipeSourceRetriever = Omit<Retriever<ExactFilter, EmbeddingModality>, 'retrieve'> & {
  retrieve(...args: never[]): Promise<RetrieverHit[]>
}

/** A weighted source entry accepted by `retrievalRecipe()`. */
export interface RetrievalRecipeSource<
  TModality extends EmbeddingModality = EmbeddingModality,
> {
  retriever: Retriever<ExactFilter, TModality>
  weight?: number
}

interface RecipeSourceEntry {
  retriever: RecipeSourceRetriever
  weight?: number
}

/** Public source input accepted by `retrievalRecipe()`. */
export type RetrievalRecipeSourceInput =
  | RecipeSourceRetriever
  | readonly [RecipeSourceRetriever, ...RecipeSourceRetriever[]]
  | readonly [RecipeSourceEntry, ...RecipeSourceEntry[]]

/** Normalized source used by the recipe runner. */
export interface NormalizedRecipeSource {
  retriever: Retriever<ExactFilter, EmbeddingModality>
  weight: number
}

/** Normalize single-source and federated source config into weighted sources. */
export function normalizeRecipeSources(input: RetrievalRecipeSourceInput): readonly NormalizedRecipeSource[] {
  if (isRetriever(input)) {
    return [{
      retriever: input as unknown as Retriever<ExactFilter, EmbeddingModality>,
      weight: 1,
    }]
  }
  return input.map((entry) => normalizeSourceEntry(entry))
}

function normalizeSourceEntry(entry: RecipeSourceRetriever | RecipeSourceEntry): NormalizedRecipeSource {
  const retriever = isSourceConfig(entry) ? entry.retriever : entry
  const weight = isSourceConfig(entry) ? (entry.weight ?? 1) : 1
  if (!Number.isFinite(weight) || weight <= 0) {
    throw new RetrievalConfigError('invalid_step_order', 'Retrieval source weight must be a positive number.')
  }
  return { retriever: retriever as unknown as Retriever<ExactFilter, EmbeddingModality>, weight }
}

function isRetriever(input: RetrievalRecipeSourceInput): input is RecipeSourceRetriever {
  return !Array.isArray(input) && '_tag' in input && input._tag === 'Retriever'
}

function isSourceConfig(entry: RecipeSourceRetriever | RecipeSourceEntry): entry is RecipeSourceEntry {
  return 'retriever' in entry
}
