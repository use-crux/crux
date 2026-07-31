/**
 * Citation-grounding constraint strategy.
 *
 * @module
 */

import type { z } from 'zod'
import type { BoundaryDef } from '../../boundary'
import type { ConstraintRun, ConstraintCheckResult } from '../types'
import type { EvidenceHit, RetrieverHit } from '../../../retrieval/types'
import type { CitationConstraintConfig } from '../../../citations/types'
import { resolveCitations } from '../../../citations/resolve'
import { createArtifact, formatCitationFeedback, selectDefaultCitations } from '../../../citations/validation'

type StructuredOutputSubject<TSchema extends z.ZodType> = {
  readonly text: string
  readonly object: z.infer<TSchema> | undefined
}

type StructuredOutputBoundary<TSchema extends z.ZodType> = BoundaryDef<
  'model.output',
  StructuredOutputSubject<TSchema>
>

/** Create a grounded-citation constraint strategy for structured output. */
export function citations<TSchema extends z.ZodType = z.ZodType<unknown>>(
  config: Omit<CitationConstraintConfig<TSchema>, 'name'>,
): ConstraintRun<StructuredOutputBoundary<TSchema>> {
  const required = config.required ?? true
  const quotePolicy = config.quotes ?? (required ? 'required' : 'optional')

  const run = async (subject: StructuredOutputSubject<TSchema>): Promise<ConstraintCheckResult> => {
    const hits = await allowedHits(config)
    const output = { text: subject.text, parsed: subject.object }
    const selected = config.select?.(output) ?? selectDefaultCitations(subject.object)

    if ((!selected || selected.length === 0) && required) {
      const artifact = createArtifact({
        hits,
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

    const resolved = resolveCitations(selected ?? [], hits, { quotes: quotePolicy })
    const artifact = {
      ...resolved.artifact,
      ...(config.groundingId ? { groundingId: config.groundingId } : {}),
      ...(config.retrieverId ? { retrieverId: config.retrieverId } : {}),
      ...(config.query ? { query: config.query } : {}),
    }

    if (resolved.valid) return { pass: true, metadata: { grounding: artifact } }
    return {
      pass: false,
      feedback: formatCitationFeedback(resolved.issues),
      metadata: { grounding: artifact },
    }
  }

  return Object.assign(run, {
    strategy: {
      kind: 'constraint.citations',
      config: { required, quotes: quotePolicy },
    },
  })
}

async function allowedHits<TSchema extends z.ZodType>(
  config: Omit<CitationConstraintConfig<TSchema>, 'name'>,
): Promise<readonly EvidenceHit[]> {
  if (config.session) return config.session.allowedHits()
  if (config.hits) return config.hits.filter(isEvidenceHit)
  throw new Error('constraint.citations(): either hits or session must be provided.')
}

function isEvidenceHit(hit: RetrieverHit): hit is EvidenceHit {
  return hit.kind !== 'finding'
}
