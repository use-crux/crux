import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  citationConstraint,
  citationSchema,
  renderCitationContext,
  resolveCitations,
} from '../../citations'
import type { RetrieverHit } from '../../retrieval'

function hit(overrides: Partial<RetrieverHit> = {}): RetrieverHit {
  return {
    namespace: 'docs',
    sourceId: 'guide.md',
    chunkId: 'chunk-1',
    content: 'Hybrid search combines dense and sparse retrieval for better recall.',
    metadata: {},
    score: 0.9,
    ...overrides,
  }
}

describe('resolveCitations()', () => {
  it('resolves a citation to an allowed hit and fills source metadata', () => {
    const result = resolveCitations(
      [
        {
          sourceId: 'guide.md',
          chunkId: 'chunk-1',
          quote: 'dense and sparse retrieval',
        },
      ],
      [
        hit({
          sourceUrl: 'https://example.com/guide',
          sourcePath: '/docs/guide.md',
          provenance: { page: 3 },
        }),
      ],
      { quotes: 'required' },
    )

    expect(result.valid).toBe(true)
    expect(result.citations[0]).toMatchObject({
      namespace: 'docs',
      sourceId: 'guide.md',
      chunkId: 'chunk-1',
      quote: 'dense and sparse retrieval',
      url: 'https://example.com/guide',
      path: '/docs/guide.md',
      provenance: { page: 3 },
    })
  })

    it('requires namespace when source and chunk are ambiguous', () => {
    const result = resolveCitations(
      [{ sourceId: 'guide.md', chunkId: 'chunk-1', quote: 'retrieval' }],
      [hit({ namespace: 'public' }), hit({ namespace: 'internal' })],
      { quotes: 'optional' },
    )

    expect(result.valid).toBe(false)
    expect(result.issues[0]).toMatchObject({
      code: 'ambiguous_hit',
      sourceId: 'guide.md',
      chunkId: 'chunk-1',
    })
  })

    it('fails when required quotes are missing or not found in the hit content', () => {
    const missing = resolveCitations([{ sourceId: 'guide.md', chunkId: 'chunk-1' }], [hit()], {
      quotes: 'required',
    })
    const notFound = resolveCitations(
      [{ sourceId: 'guide.md', chunkId: 'chunk-1', quote: 'unrelated quote' }],
      [hit()],
      { quotes: 'required' },
    )

    expect(missing.valid).toBe(false)
    expect(missing.issues[0].code).toBe('missing_quote')
    expect(notFound.valid).toBe(false)
    expect(notFound.issues[0].code).toBe('quote_not_found')
  })

    it('validates spans strictly when present', () => {
    const content = 'The quick brown fox jumps.'
    const ok = resolveCitations(
      [{ sourceId: 'guide.md', chunkId: 'chunk-1', quote: 'quick brown', span: { start: 4, end: 15 } }],
      [hit({ content })],
      { quotes: 'required' },
    )
    const bad = resolveCitations(
      [{ sourceId: 'guide.md', chunkId: 'chunk-1', quote: 'quick brown', span: { start: 0, end: 3 } }],
      [hit({ content })],
      { quotes: 'required' },
    )

    expect(ok.valid).toBe(true)
    expect(bad.valid).toBe(false)
    expect(bad.issues[0].code).toBe('invalid_span')
  })
})

describe('citationConstraint()', () => {
  it('validates structured output citations and returns metadata artifacts', async () => {
    const schema = z.object({
      answer: z.string(),
      citations: z.array(citationSchema),
    })
    const check = citationConstraint<typeof schema>({
      hits: [hit()],
      quotes: 'required',
    })

    const result = await check.check(
      {
        text: '',
        parsed: {
          answer: 'Hybrid search improves recall.',
          citations: [
            {
              sourceId: 'guide.md',
              chunkId: 'chunk-1',
              quote: 'dense and sparse retrieval',
            },
          ],
        },
      },
      { promptId: 'answer', model: 'test', traceId: undefined, attempt: 0, metadata: {} },
    )

    expect(result.pass).toBe(true)
    expect(result.metadata).toMatchObject({
      grounding: {
        summary: {
          citationCount: 1,
          validCitationCount: 1,
          invalidCitationCount: 0,
        },
      },
    })
  })

    it('fails with actionable feedback when citations are missing', async () => {
    const check = citationConstraint({
      hits: [hit()],
      required: true,
      quotes: 'required',
    })

    const result = await check.check(
      { text: 'No sources.', parsed: { answer: 'No sources.' } },
      { promptId: 'answer', model: 'test', traceId: undefined, attempt: 0, metadata: {} },
    )

    expect(result.pass).toBe(false)
    expect(result.feedback).toContain('citations')
    expect(result.metadata?.grounding).toMatchObject({
      summary: {
        citationCount: 0,
        validCitationCount: 0,
        invalidCitationCount: 1,
      },
    })
  })
})

describe('renderCitationContext()', () => {
  it('renders source and chunk identifiers for model-visible evidence', () => {
    const rendered = renderCitationContext([hit()], { title: 'Evidence' })

    expect(rendered).toContain('## Evidence')
    expect(rendered).toContain('Source: docs/guide.md/chunk-1')
    expect(rendered).toContain('Hybrid search combines')
  })
})
