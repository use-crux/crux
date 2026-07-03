/**
 * Citation resolution against retrieved hits.
 *
 * {@link resolveCitations} is the public entry: it validates a set of citations
 * against the allowed {@link RetrieverHit}s (matching, ambiguity, quote, and
 * span checks), wraps the work in an observability span, and emits a citation
 * report artifact.
 *
 * @module
 */

import { observe } from '../observability'
import type { RetrieverHit } from '../retrieval'
import { citationSchema, type Citation } from './schema'
import { groundingHitKey } from './session'
import type {
  CitationQuotePolicy,
  CitationResolveOptions,
  CitationValidationArtifact,
  CitationValidationResult,
  CitationIssue,
  ResolvedCitation,
} from './types'
import { createArtifact, formatCitation, issue, validateQuote, validateSpan } from './validation'

/**
 * Validate citations against the hits the model was allowed to cite.
 *
 * Each citation must match exactly one retrieved hit; depending on
 * `options.quotes`, quotes may be required and must appear verbatim, and any
 * declared span must fall inside the hit content. The pass is wrapped in an
 * observability span and emits a `citation.report` artifact.
 *
 * @param citations - Citations produced by the model.
 * @param hits - The retrieved hits the model was allowed to cite.
 * @param options - Quote policy. Defaults to `'optional'`.
 * @returns A {@link CitationValidationResult} with resolved citations + issues.
 */
export function resolveCitations(
  citations: readonly Citation[],
  hits: readonly RetrieverHit[],
  options: CitationResolveOptions = {},
): CitationValidationResult {
  const quotePolicy = options.quotes ?? 'optional'
  const allowedHits = dedupeHits(hits)
  const span = observe.openSpan({
    name: 'citation.resolve',
    family: 'citation',
    primitive: 'citation.check',
    attributes: {
      citationCount: citations.length,
      allowedHitCount: hits.length,
      quotePolicy,
    },
  })

  try {
    let result: CitationValidationResult | undefined
    span.withContext(() => {
      result = resolveCitationsInner(citations, allowedHits, quotePolicy)
    })
    if (!result) throw new Error('citation.resolve did not produce a validation result.')
    const validationResult = result
    span.withContext(() => {
      emitCitationArtifact(span.spanId, validationResult.artifact)
    })
    span.end({
      attributes: {
        citationCount: validationResult.artifact.summary.citationCount,
        validCitationCount: validationResult.artifact.summary.validCitationCount,
        invalidCitationCount: validationResult.artifact.summary.invalidCitationCount,
        issueCodes: validationResult.artifact.summary.issueCodes,
        allowedHitCount: hits.length,
        quotePolicy,
        valid: validationResult.valid,
      },
    })
    return validationResult
  } catch (error) {
    span.error(error, {
      citationCount: citations.length,
      allowedHitCount: hits.length,
      quotePolicy,
    })
    throw error
  }
}

/** Core matching/validation loop, run inside the citation span context. */
function resolveCitationsInner(
  citations: readonly Citation[],
  hits: readonly RetrieverHit[],
  quotePolicy: CitationQuotePolicy,
): CitationValidationResult {
  const resolved: ResolvedCitation[] = []
  const issues: CitationIssue[] = []

  for (const citation of citations) {
    const parsed = citationSchema.safeParse(citation)
    if (!parsed.success) {
      issues.push({
        code: 'unknown_hit',
        message: `Citation must include sourceId and chunkId: ${parsed.error.message}`,
        citation,
        namespace: citation.namespace,
        sourceId: citation.sourceId,
        chunkId: citation.chunkId,
      })
      continue
    }

    const matches = hits.filter((hit) => {
      if (hit.sourceId !== citation.sourceId || hit.chunkId !== citation.chunkId) return false
      return citation.namespace === undefined || hit.namespace === citation.namespace
    })

    if (matches.length === 0) {
      issues.push(
        issue('unknown_hit', citation, `Citation ${formatCitation(citation)} does not match a retrieved hit.`),
      )
      continue
    }

    if (citation.namespace === undefined && distinctNamespaces(matches).length > 1) {
      issues.push(
        issue(
          'ambiguous_hit',
          citation,
          `Citation ${formatCitation(citation)} is ambiguous across namespaces. Include namespace.`,
        ),
      )
      continue
    }

    const hit = matches[0]
    const quoteIssue = validateQuote(citation, hit, quotePolicy)
    if (quoteIssue) {
      issues.push(quoteIssue)
      continue
    }

    const spanIssue = validateSpan(citation, hit)
    if (spanIssue) {
      issues.push(spanIssue)
      continue
    }

    resolved.push({
      ...citation,
      namespace: hit.namespace,
      ...((citation.url ?? hit.sourceUrl) ? { url: citation.url ?? hit.sourceUrl } : {}),
      ...((citation.path ?? hit.sourcePath) ? { path: citation.path ?? hit.sourcePath } : {}),
      metadata: citation.metadata ?? hit.metadata,
      ...(hit.provenance ? { provenance: hit.provenance } : {}),
      hit: {
        namespace: hit.namespace,
        sourceId: hit.sourceId,
        chunkId: hit.chunkId,
        content: hit.content,
        score: hit.score,
        metadata: hit.metadata,
        ...(hit.sourceUrl ? { sourceUrl: hit.sourceUrl } : {}),
        ...(hit.sourcePath ? { sourcePath: hit.sourcePath } : {}),
        ...(hit.provenance ? { provenance: hit.provenance } : {}),
      },
    })
  }

  const artifact = createArtifact({
    hits,
    citations: resolved,
    issues,
    requestedCount: citations.length,
  })

  return {
    valid: issues.length === 0,
    citations: resolved,
    issues,
    artifact,
  }
}

function dedupeHits(hits: readonly RetrieverHit[]): RetrieverHit[] {
  const deduped = new Map<string, RetrieverHit>()
  for (const hit of hits) {
    const key = groundingHitKey(hit)
    if (!deduped.has(key)) deduped.set(key, hit)
  }
  return [...deduped.values()]
}

function distinctNamespaces(hits: readonly RetrieverHit[]): string[] {
  return Array.from(new Set(hits.map((hit) => hit.namespace)))
}

/** Emit the citation report artifact and link it to the active span. */
function emitCitationArtifact(
  spanId: ReturnType<typeof observe.openSpan>['spanId'],
  artifact: CitationValidationArtifact,
): void {
  const artifactId = observe.artifact({
    kind: 'citation.report',
    contentType: 'application/json',
    encoding: 'json',
    preview: {
      kind: 'citation.report',
      valid: artifact.summary.invalidCitationCount === 0,
      groundingId: artifact.groundingId,
      retrieverId: artifact.retrieverId,
      query: artifact.query,
      markers: artifact.resolvedCitations.slice(0, 50).map((citation, index) => ({
        marker: `[${index + 1}]`,
        ...(citation.outputSpan ? { start: citation.outputSpan.start, end: citation.outputSpan.end } : {}),
        ...(citation.outputQuote ? { outputQuote: citation.outputQuote } : {}),
        sourceId: citation.sourceId,
        chunkId: citation.chunkId,
        score: citation.hit.score,
        grounded: true,
        note: citation.quote,
      })),
      allowedHits: artifact.allowedHits.slice(0, 50),
      resolvedCitations: artifact.resolvedCitations.slice(0, 50).map((citation) => ({
        namespace: citation.namespace,
        sourceId: citation.sourceId,
        chunkId: citation.chunkId,
        score: citation.hit.score,
        hasQuote: citation.quote !== undefined,
        ...(citation.outputSpan ? { start: citation.outputSpan.start, end: citation.outputSpan.end } : {}),
        ...(citation.outputQuote ? { outputQuote: citation.outputQuote } : {}),
        url: citation.url,
        path: citation.path,
      })),
      citationIssues: artifact.citationIssues.slice(0, 50).map((issue) => ({
        code: issue.code,
        message: issue.message,
        namespace: issue.namespace,
        sourceId: issue.sourceId,
        chunkId: issue.chunkId,
      })),
      summary: artifact.summary,
    },
    attributes: {
      primitive: 'citation.check',
      groundingId: artifact.groundingId,
      retrieverId: artifact.retrieverId,
      citationCount: artifact.summary.citationCount,
      validCitationCount: artifact.summary.validCitationCount,
      invalidCitationCount: artifact.summary.invalidCitationCount,
      issueCodes: artifact.summary.issueCodes,
      valid: artifact.summary.invalidCitationCount === 0,
    },
  })
  if (!artifactId) return
  observe.edge({
    edgeType: 'produced',
    from: { kind: 'span', id: spanId },
    to: { kind: 'artifact', id: artifactId },
    attributes: { primitive: 'citation.check' },
  })
}
