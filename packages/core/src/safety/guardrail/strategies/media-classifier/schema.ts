/** Strict dynamic score schema for authored media-classifier categories. */

import { z } from 'zod'
import type { NormalizedMediaClassifierCategory } from './types'

/** Build an exact score-only schema keyed by the authored category IDs. */
export function mediaClassifierSchema(
  categories: readonly NormalizedMediaClassifierCategory[],
) {
  const scores = Object.create(null) as Record<string, z.ZodNumber>
  for (const category of categories) {
    scores[category.id] = z.number().finite().min(0).max(1)
  }
  const categoryIds = categories.map((category) => category.id)
  const scoreObject = z
    .custom<Record<string, unknown>>(
      (value) => hasExactOwnKeys(value, categoryIds),
      {
        message:
          'Scores must contain exactly the authored category keys as own properties.',
      },
    )
    .pipe(z.object(scores).strict())
  return z.object({ scores: scoreObject }).strict()
}

/** Inferred strict score-envelope schema used by the classifier call. */
export type MediaClassifierSchema = ReturnType<typeof mediaClassifierSchema>

function hasExactOwnKeys(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false

  const actualKeys = Object.keys(value)
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    )
  )
}
