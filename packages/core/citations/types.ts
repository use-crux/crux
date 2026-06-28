/**
 * Public type contracts for the citations + grounding domain.
 *
 * Covers citation resolution options, validation issues/results, the
 * citation-validation artifact emitted to observability, the citation
 * constraint config, and the `grounding()` injectable contract.
 *
 * @module
 */

import type { z } from 'zod'
import type { Retriever, RetrieverHit, RetrievalInjectMode, RetrievalToolConfig } from '../retrieval'
import type { InjectableEntry, PromptInjection } from '../prompt/context-types'
import type { Citation } from './schema'

/** Whether a citation quote is forbidden, optional, or required. */
export type CitationQuotePolicy = false | 'optional' | 'required'

/** Options for {@link resolveCitations}. */
export interface CitationResolveOptions {
  quotes?: CitationQuotePolicy
}

/** Discriminator codes for the ways a citation can fail validation. */
export type CitationIssueCode = 'unknown_hit' | 'ambiguous_hit' | 'missing_quote' | 'quote_not_found' | 'invalid_span'

/** A single citation validation failure with its offending citation. */
export interface CitationIssue {
  code: CitationIssueCode
  message: string
  citation: Citation
  namespace?: string
  sourceId: string
  chunkId: string
}

/** A citation that matched a retrieved hit, enriched with the hit's provenance. */
export interface ResolvedCitation extends Citation {
  namespace: string
  url?: string
  path?: string
  metadata?: Record<string, unknown>
  provenance?: Record<string, unknown>
  hit: {
    namespace: string
    sourceId: string
    chunkId: string
    content: string
    score: number
    metadata: Record<string, unknown>
    sourceUrl?: string
    sourcePath?: string
    provenance?: Record<string, unknown>
  }
}

/** Counts summarizing a citation validation pass. */
export interface CitationValidationSummary {
  citationCount: number
  validCitationCount: number
  invalidCitationCount: number
  issueCodes: CitationIssueCode[]
}

/** The structured artifact emitted to observability for a citation check. */
export interface CitationValidationArtifact {
  groundingId?: string
  retrieverId?: string
  query?: string
  allowedHits: Array<{
    namespace: string
    sourceId: string
    chunkId: string
    score: number
  }>
  resolvedCitations: ResolvedCitation[]
  citationIssues: CitationIssue[]
  summary: CitationValidationSummary
}

/** The result of resolving citations against a set of allowed hits. */
export interface CitationValidationResult {
  valid: boolean
  citations: ResolvedCitation[]
  issues: CitationIssue[]
  artifact: CitationValidationArtifact
}

/** Config for {@link citationConstraint}: the grounded-citation safety check. */
export interface CitationConstraintConfig<TSchema extends z.ZodType = z.ZodType<unknown>> {
  hits: readonly RetrieverHit[]
  required?: boolean
  quotes?: CitationQuotePolicy
  name?: string
  groundingId?: string
  retrieverId?: string
  query?: string
  select?: (output: { text: string; parsed: z.infer<TSchema> | undefined }) => readonly Citation[] | undefined
}

/** Config for {@link grounding}: retrieval-backed prompt grounding. */
export interface GroundingConfig {
  id: string
  retriever: Retriever
  query: string | ((args: { input: Record<string, unknown> }) => string)
  limit?: number
  inject?: RetrievalInjectMode
  render?: (args: {
    hits: RetrieverHit[]
    query: string
    input: Record<string, unknown>
    retriever: Retriever
  }) => string | Promise<string>
  select?: (args: {
    hits: RetrieverHit[]
    query: string
    input: Record<string, unknown>
    retriever: Retriever
  }) => RetrieverHit[] | Promise<RetrieverHit[]>
  citations?: {
    required?: boolean
    quotes?: CitationQuotePolicy
    select?: (output: { text: string; parsed: unknown | undefined }) => readonly Citation[] | undefined
  }
  tools?: false | RetrievalToolConfig
}

/** A grounding injectable: injects retrieved context/tools and citation checks. */
export interface Grounding extends InjectableEntry {
  readonly _tag: 'Grounding'
  readonly retriever: Retriever
  resolve(input: Record<string, unknown>): Promise<GroundingResolution>
}

/** The hits a {@link Grounding} resolved for a given input. */
export interface GroundingResolution {
  groundingId: string
  retrieverId: string
  query: string
  hits: RetrieverHit[]
}
