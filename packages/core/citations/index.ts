import { z } from 'zod'
import { context } from '../prompt/context'
import { constraint } from '../safety/constraint'
import type { Constraint } from '../safety/constraint'
import { observe } from '../observability'
import type { Retriever, RetrieverHit, RetrievalInjectMode, RetrievalToolConfig } from '../retrieval'
import type { InjectableEntry, PromptInjection } from '../types'

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

export type Citation = z.infer<typeof citationSchema>

export type CitationQuotePolicy = false | 'optional' | 'required'

export interface CitationResolveOptions {
  quotes?: CitationQuotePolicy
}

export type CitationIssueCode = 'unknown_hit' | 'ambiguous_hit' | 'missing_quote' | 'quote_not_found' | 'invalid_span'

export interface CitationIssue {
  code: CitationIssueCode
  message: string
  citation: Citation
  namespace?: string
  sourceId: string
  chunkId: string
}

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

export interface CitationValidationSummary {
  citationCount: number
  validCitationCount: number
  invalidCitationCount: number
  issueCodes: CitationIssueCode[]
}

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

export interface CitationValidationResult {
  valid: boolean
  citations: ResolvedCitation[]
  issues: CitationIssue[]
  artifact: CitationValidationArtifact
}

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

export interface Grounding extends InjectableEntry {
  readonly _tag: 'Grounding'
  readonly retriever: Retriever
  resolve(input: Record<string, unknown>): Promise<GroundingResolution>
}

export interface GroundingResolution {
  groundingId: string
  retrieverId: string
  query: string
  hits: RetrieverHit[]
}

export function grounding(config: GroundingConfig): Grounding {
  if (!config.id.trim()) {
    throw new Error('grounding(): id must be non-empty.')
  }
  const injectMode = config.inject ?? 'context'

  return Object.freeze({
    _tag: 'Grounding' as const,
    id: config.id,
    retriever: config.retriever,
    async inject({ input }: { input: Record<string, unknown>; promptId?: string }): Promise<PromptInjection> {
      const query = resolveGroundingQuery(config.query, input)
      const allowedHits: RetrieverHit[] = []
      const contexts = []
      let tools: PromptInjection['tools']

      if (injectMode === 'context' || injectMode === 'both') {
        allowedHits.push(...(await retrieveGroundingHits(config, query, input)))
        const rendered =
          (await config.render?.({ hits: allowedHits, query, input, retriever: config.retriever })) ??
          renderCitationContext(allowedHits)
        if (rendered) {
          contexts.push(
            context({
              id: `grounding:${config.id}`,
              description: `Grounding context for ${config.id}`,
              family: 'retriever',
              system: rendered,
            }),
          )
        }
      }

      if (injectMode === 'tool' || injectMode === 'both') {
        const toolConfig = config.tools === false ? { enabled: false } : config.tools
        if (toolConfig?.enabled !== false) {
          tools = config.retriever.asTools({
            ...(toolConfig ?? {}),
            prefix: toolConfig?.prefix === undefined || toolConfig.prefix === true ? config.id : toolConfig.prefix,
            initialHits: allowedHits,
          })
          wrapSearchToolsForGrounding(tools, allowedHits)
        }
      }

      const citations = config.citations
      const required = citations?.required ?? true
      const constraints =
        required || citations
          ? [
              citationConstraint({
                hits: allowedHits,
                required,
                quotes: citations?.quotes ?? (required ? 'required' : 'optional'),
                groundingId: config.id,
                retrieverId: config.retriever.id,
                query,
                select: citations?.select,
              }),
            ]
          : []

      return {
        ...(contexts.length ? { contexts } : {}),
        ...(tools && Object.keys(tools).length > 0 ? { tools } : {}),
        ...(constraints.length ? { constraints } : {}),
        metadata: {
          grounding: {
            groundingId: config.id,
            retrieverId: config.retriever.id,
            query,
            allowedHits: allowedHits.map((hit) => ({
              namespace: hit.namespace,
              sourceId: hit.sourceId,
              chunkId: hit.chunkId,
              score: hit.score,
            })),
          },
        },
      }
    },
    async resolve(input: Record<string, unknown>): Promise<GroundingResolution> {
      const query = resolveGroundingQuery(config.query, input)
      const hits = await retrieveGroundingHits(config, query, input)
      return {
        groundingId: config.id,
        retrieverId: config.retriever.id,
        query,
        hits,
      }
    },
  })
}

export function resolveCitations(
  citations: readonly Citation[],
  hits: readonly RetrieverHit[],
  options: CitationResolveOptions = {},
): CitationValidationResult {
  const quotePolicy = options.quotes ?? 'optional'
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
      result = resolveCitationsInner(citations, hits, quotePolicy)
    })
    if (!result) throw new Error('citation.resolve did not produce a validation result.')
    const validationResult = result
    span.withContext(() => {
      emitCitationArtifact(span.spanId, validationResult.artifact)
    })
    span.end({
      citationCount: validationResult.artifact.summary.citationCount,
      validCitationCount: validationResult.artifact.summary.validCitationCount,
      invalidCitationCount: validationResult.artifact.summary.invalidCitationCount,
      issueCodes: validationResult.artifact.summary.issueCodes,
      allowedHitCount: hits.length,
      quotePolicy,
      valid: validationResult.valid,
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

    if (citation.namespace === undefined && matches.length > 1) {
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

export function renderCitationContext(
  hits: readonly RetrieverHit[],
  options: {
    title?: string
    maxContentChars?: number
  } = {},
): string {
  if (hits.length === 0) return ''
  const title = options.title ?? 'Grounded Sources'
  const maxContentChars = options.maxContentChars ?? 4_000
  const lines = [`## ${title}`, 'Use only these retrieved sources for grounded claims. Cite with sourceId and chunkId.']

  for (const hit of hits) {
    lines.push('')
    lines.push(`Source: ${hit.namespace}/${hit.sourceId}/${hit.chunkId}`)
    if (hit.sourceUrl) lines.push(`URL: ${hit.sourceUrl}`)
    if (hit.sourcePath) lines.push(`Path: ${hit.sourcePath}`)
    lines.push(`Score: ${hit.score}`)
    lines.push(hit.content.slice(0, maxContentChars))
  }

  return lines.join('\n')
}

async function retrieveGroundingHits(
  config: GroundingConfig,
  query: string,
  input: Record<string, unknown>,
): Promise<RetrieverHit[]> {
  const hits = await config.retriever.retrieve(query, { limit: config.limit })
  return config.select ? config.select({ hits, query, input, retriever: config.retriever }) : hits
}

function resolveGroundingQuery(
  query: string | ((args: { input: Record<string, unknown> }) => string),
  input: Record<string, unknown>,
): string {
  const resolved = typeof query === 'function' ? query({ input }) : query
  if (!resolved.trim()) {
    throw new Error('grounding(): query must resolve to a non-empty string.')
  }
  return resolved
}

function wrapSearchToolsForGrounding(tools: NonNullable<PromptInjection['tools']>, allowedHits: RetrieverHit[]): void {
  for (const tool of Object.values(tools) as Array<{ execute?: unknown }>) {
    if (typeof tool.execute !== 'function') continue
    const original = tool.execute
    tool.execute = async (args: unknown) => {
      const result = await original(args)
      if (typeof result === 'string') {
        try {
          const parsed = JSON.parse(result)
          if (Array.isArray(parsed)) {
            allowedHits.push(...parsed.filter(isRetrieverHitLike))
          }
        } catch {
          // Tool output is still returned to the model; citation validation just
          // cannot learn additional allowed hits from non-JSON output.
        }
      }
      return result
    }
  }
}

function isRetrieverHitLike(value: unknown): value is RetrieverHit {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RetrieverHit>
  return (
    typeof candidate.namespace === 'string' &&
    typeof candidate.sourceId === 'string' &&
    typeof candidate.chunkId === 'string' &&
    typeof candidate.content === 'string' &&
    typeof candidate.score === 'number' &&
    typeof candidate.metadata === 'object' &&
    candidate.metadata !== null
  )
}

function validateQuote(citation: Citation, hit: RetrieverHit, policy: CitationQuotePolicy): CitationIssue | undefined {
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

function validateSpan(citation: Citation, hit: RetrieverHit): CitationIssue | undefined {
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

function selectDefaultCitations(parsed: unknown): readonly Citation[] | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined
  const candidate = (parsed as { citations?: unknown }).citations
  if (!Array.isArray(candidate)) return undefined
  const citations = z.array(citationSchema).safeParse(candidate)
  return citations.success ? citations.data : undefined
}

function createArtifact(args: {
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
      sourceId: hit.sourceId,
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

function issue(code: CitationIssueCode, citation: Citation, message: string): CitationIssue {
  return {
    code,
    message,
    citation,
    namespace: citation.namespace,
    sourceId: citation.sourceId,
    chunkId: citation.chunkId,
  }
}

function formatCitation(citation: Citation): string {
  return citation.namespace
    ? `${citation.namespace}/${citation.sourceId}/${citation.chunkId}`
    : `${citation.sourceId}/${citation.chunkId}`
}

function formatCitationFeedback(issues: readonly CitationIssue[]): string {
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
