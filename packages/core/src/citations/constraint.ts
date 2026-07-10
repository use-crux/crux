/**
 * The citation constraint: a {@link Constraint} that enforces grounded citations.
 *
 * {@link citationConstraint} bridges citation resolution into the safety
 * constraint system. It selects citations from model output, resolves them
 * against the allowed hits, and passes/fails the constraint with corrective
 * feedback and a grounding artifact attached.
 *
 * @module
 */

import type { z } from 'zod'
import type { BoundaryDef } from '../safety/boundary'
import { boundary } from '../safety/boundary'
import { constraint } from '../safety/constraint'
import type { Constraint } from '../safety/constraint'
import type { CitationConstraintConfig } from './types'

type CitationOutputBoundary<TSchema extends z.ZodType> = BoundaryDef<
  'model.output',
  { readonly text: string; readonly object: z.infer<TSchema> | undefined }
>

/**
 * Build a {@link Constraint} that requires output to cite retrieved sources.
 *
 * The constraint extracts citations (via `config.select` or a default
 * `citations` array), resolves them against `config.hits`, and fails with
 * actionable feedback when citations are missing or invalid. A grounding
 * artifact is attached to the constraint result metadata either way.
 *
 * @param config - Allowed hits, quote/required policy, and selection logic.
 * @returns A constraint for use in generation safety checks.
 */
export function citationConstraint<TSchema extends z.ZodType = z.ZodType<unknown>>(
  config: CitationConstraintConfig<TSchema>,
): Constraint<CitationOutputBoundary<TSchema>> {
  return constraint({
    id: config.name ?? 'grounded-citations',
    on: boundary.output.both<z.infer<TSchema> | undefined>(),
    run: constraint.citations(config),
  })
}
