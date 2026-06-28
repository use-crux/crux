/**
 * Citations + grounding — `@use-crux/core/citations`.
 *
 * Author retrieval-backed {@link grounding} that injects sources and enforces
 * grounded citations, validate model citations against allowed hits with
 * {@link resolveCitations}, bridge that into safety via {@link citationConstraint},
 * and render retrieved sources with {@link renderCitationContext}.
 *
 * @module
 */

export { citationSchema, type Citation } from './schema'

export type {
  CitationQuotePolicy,
  CitationResolveOptions,
  CitationIssueCode,
  CitationIssue,
  ResolvedCitation,
  CitationValidationSummary,
  CitationValidationArtifact,
  CitationValidationResult,
  CitationConstraintConfig,
  GroundingConfig,
  Grounding,
  GroundingResolution,
} from './types'

export { resolveCitations } from './resolve'
export { citationConstraint } from './constraint'
export { grounding, renderCitationContext } from './grounding'
