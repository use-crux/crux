/**
 * The canonical citation schema and inferred `Citation` type.
 *
 * A citation references a retrieved chunk (`sourceId` + `chunkId`, optionally
 * `namespace`) and may carry a verbatim `quote`, character `span`s into the
 * source and the model output, and source `url`/`path`/`metadata`. The Zod
 * schema is the single source of truth; {@link Citation} is its inferred type.
 *
 * @module
 */

import { z } from 'zod'

/** Zod schema validating a single citation produced by a model. */
export const citationSchema = z.object({
  namespace: z.string().min(1).optional(),
  sourceId: z.string().min(1),
  chunkId: z.string().min(1),
  quote: z.string().min(1).optional(),
  span: z
    .object({
      start: z.number().int().nonnegative(),
      end: z.number().int().positive(),
    })
    .optional(),
  outputSpan: z
    .object({
      start: z.number().int().nonnegative(),
      end: z.number().int().positive(),
    })
    .optional(),
  outputQuote: z.string().min(1).optional(),
  url: z.string().url().optional(),
  path: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

/** A single citation: the inferred type of {@link citationSchema}. */
export type Citation = z.infer<typeof citationSchema>
