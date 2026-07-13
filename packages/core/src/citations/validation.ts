/**
 * Internal citation validation + artifact helpers.
 *
 * Pure helpers shared by the resolver and the constraint bridge: quote/span
 * validation, default citation selection from model output, issue formatting,
 * and {@link CitationValidationArtifact} construction. Not part of the public
 * package surface.
 *
 * @module
 */

import { z } from 'zod'
import type { RetrieverHit } from '../retrieval'
import { citationSchema, type Citation } from './schema'
import type {
  CitationIssue,
  CitationIssueCode,
  CitationQuotePolicy,
  CitationValidationArtifact,
  ResolvedCitation,
} from './types'

/** Validate a citation's quote against the cited hit per the quote policy. */
export function validateQuote(
  citation: Citation,
  hit: RetrieverHit,
  policy: CitationQuotePolicy,
): CitationIssue | undefined {
  if (policy === false) return undefined
  if (!citation.quote) {
    return policy === 'required'
      ? issue('missing_quote', citation, `Citation ${formatCitation(citation)} must include a quote.`)
      : undefined
  }
  if (!hit.content.includes(citation.quote)) {
    return issue(
      'quote_not_found',
      citation,
      `Citation ${formatCitation(citation)} quote was not found in the retrieved hit content.`,
    )
  }
  return undefined
}

/** Validate a citation's character span against the cited hit content. */
export function validateSpan(citation: Citation, hit: RetrieverHit): CitationIssue | undefined {
  if (!citation.span) return undefined
  const { start, end } = citation.span
  if (end <= start || end > hit.content.length) {
    return issue('invalid_span', citation, `Citation ${formatCitation(citation)} span is outside the hit content.`)
  }
  if (citation.quote !== undefined && hit.content.slice(start, end) !== citation.quote) {
    return issue(
      'invalid_span',
      citation,
      `Citation ${formatCitation(citation)} span does not match the citation quote.`,
    )
  }
  return undefined
}

/** Extract a `citations` array from parsed model output when shaped correctly. */
export function selectDefaultCitations(parsed: unknown): readonly Citation[] | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined
  const candidate = (parsed as { citations?: unknown }).citations
  if (!Array.isArray(candidate)) return undefined
  const citations = z.array(citationSchema).safeParse(candidate)
  return citations.success ? citations.data : undefined
}

/** Build the structured citation-validation artifact for observability. */
export function createArtifact(args: {
  hits: readonly RetrieverHit[]
  citations: readonly ResolvedCitation[]
  issues: readonly CitationIssue[]
  requestedCount: number
  groundingId?: string
  retrieverId?: string
  query?: string
}): CitationValidationArtifact {
  return {
    ...(args.groundingId ? { groundingId: args.groundingId } : {}),
    ...(args.retrieverId ? { retrieverId: args.retrieverId } : {}),
    ...(args.query ? { query: args.query } : {}),
    allowedHits: args.hits.map((hit) => ({
      namespace: hit.namespace,
      sourceId: hit.source.id,
      chunkId: hit.chunkId,
      score: hit.score,
    })),
    resolvedCitations: [...args.citations],
    citationIssues: [...args.issues],
    summary: {
      citationCount: args.requestedCount,
      validCitationCount: args.citations.length,
      invalidCitationCount: args.issues.length,
      issueCodes: [...new Set(args.issues.map((item) => item.code))],
    },
  }
}

/** Construct a {@link CitationIssue} carrying the offending citation's keys. */
export function issue(code: CitationIssueCode, citation: Citation, message: string): CitationIssue {
  return {
    code,
    message,
    citation,
    namespace: citation.namespace,
    sourceId: citation.sourceId,
    chunkId: citation.chunkId,
  }
}

/** Format a citation as `namespace/sourceId/chunkId` for human-readable messages. */
export function formatCitation(citation: Citation): string {
  return citation.namespace
    ? `${citation.namespace}/${citation.sourceId}/${citation.chunkId}`
    : `${citation.sourceId}/${citation.chunkId}`
}

/** Render citation issues into actionable retry feedback for the model. */
export function formatCitationFeedback(issues: readonly CitationIssue[]): string {
  return issues
    .map((item) => {
      switch (item.code) {
        case 'ambiguous_hit':
          return `${item.message} Add the namespace field to the citation.`
        case 'missing_quote':
          return `${item.message} Include an exact quote from the cited chunk.`
        case 'quote_not_found':
          return `${item.message} Use only verbatim text from the cited chunk.`
        case 'invalid_span':
          return `${item.message} Remove the span or make it match the quoted text.`
        case 'unknown_hit':
          return `${item.message} Cite only sourceId/chunkId pairs from the retrieved sources.`
      }
    })
    .join('\n')
}
