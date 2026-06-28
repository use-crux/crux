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
import { constraint } from '../safety/constraint'
import type { Constraint } from '../safety/constraint'
import { resolveCitations } from './resolve'
import type { CitationConstraintConfig } from './types'
import { createArtifact, formatCitationFeedback, selectDefaultCitations } from './validation'

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
): Constraint<TSchema> {
  const required = config.required ?? true
  const quotePolicy = config.quotes ?? (required ? 'required' : 'optional')

  return constraint<TSchema>({
    name: config.name ?? 'grounded-citations',
    check: (output) => {
      const citations = config.select?.(output) ?? selectDefaultCitations(output.parsed)
      if ((!citations || citations.length === 0) && required) {
        const artifact = createArtifact({
          hits: config.hits,
          citations: [],
          issues: [
            {
              code: 'missing_quote',
              message: 'Output must include a citations array with at least one citation.',
              citation: { sourceId: '', chunkId: '' },
              sourceId: '',
              chunkId: '',
            },
          ],
          requestedCount: 0,
          groundingId: config.groundingId,
          retrieverId: config.retrieverId,
          query: config.query,
        })
        return {
          pass: false,
          feedback:
            'Add a citations array. Each citation must include sourceId, chunkId, and a quote copied from the cited source.',
          metadata: { grounding: artifact },
        }
      }

      const result = resolveCitations(citations ?? [], config.hits, { quotes: quotePolicy })
      const artifact = {
        ...result.artifact,
        groundingId: config.groundingId,
        retrieverId: config.retrieverId,
        query: config.query,
      }
      if (result.valid) {
        return {
          pass: true,
          metadata: { grounding: artifact },
        }
      }
      return {
        pass: false,
        feedback: formatCitationFeedback(result.issues),
        metadata: { grounding: artifact },
      }
    },
  })
}
