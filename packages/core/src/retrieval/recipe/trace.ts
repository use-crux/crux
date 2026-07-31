/**
 * Trace builders for named retrieval recipes.
 *
 * @module
 */

import type { RetrieveRequest } from '../request'
import { projectErrorForObservation } from '../../observability/error-projection'
import type { RetrievalSourceTrace, RetrievalStepKind } from './step'

/** Serializable error details captured on failed recipe steps. */
export interface RecipeTraceError {
  message: string
  name?: string
}

/** A trace record for one recipe step. */
export interface StepTrace {
  stepId: string
  kind: RetrievalStepKind
  status: 'success' | 'error' | 'skipped'
  durationMs: number
  inputQueryCount?: number
  outputQueryCount?: number
  inputHitCount?: number
  outputHitCount?: number
  warnings: readonly string[]
  sources?: readonly RetrievalSourceTrace[]
  error?: RecipeTraceError
}

/** Trace record for a full recipe run. */
export interface RecipeTrace {
  id: string
  recipeId: string
  fingerprint: string
  retrieverId: string
  startedAt: number
  durationMs: number
  input: RetrieveRequest
  query: string
  steps: readonly StepTrace[]
  resultCount: number
  warnings: readonly string[]
  errors: readonly RecipeTraceError[]
}

/** Convert an arbitrary thrown value into serializable recipe trace details. */
export function serializeRecipeError(error: unknown): RecipeTraceError {
  error = projectErrorForObservation(error)
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    }
  }
  return { message: String(error) }
}

/** Return the count field relevant to a step input or output payload. */
export function countStepPayload(value: { queries?: readonly unknown[]; hits?: readonly unknown[] }): {
  queryCount?: number
  hitCount?: number
} {
  if (value.queries) return { queryCount: value.queries.length }
  if (value.hits) return { hitCount: value.hits.length }
  return {}
}
