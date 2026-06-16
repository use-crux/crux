import { evaluate, type Scorer } from '@crux/core/quality'

interface SupportQuestion {
  readonly question: string
}

interface SupportAnswer {
  readonly answer: string
  readonly citations: readonly string[]
}

interface CitationExpectation {
  readonly requiredSources: readonly string[]
}

/**
 * Pure-code scorer used to demonstrate post-score assertions.
 *
 * Real projects can replace this with `scorers.judge()` or a retrieval metric;
 * the important bit is the literal `scorerName`, which makes
 * `ctx.score.citation_valid` available in the `assert` callback.
 */
const citationValid = Object.assign(
  (({ output, expected }) => {
    const required = new Set(expected?.requiredSources ?? [])
    const cited = new Set(output.citations)
    const matched = [...required].filter((source) => cited.has(source)).length
    const score = required.size === 0 ? 1 : matched / required.size

    return {
      name: 'citation_valid',
      score,
      label: score === 1 ? 'complete' : 'missing-citations',
      metadata: { matched, required: required.size },
    }
  }) satisfies Scorer<SupportQuestion, SupportAnswer, CitationExpectation, 'citation_valid'>,
  { scorerName: 'citation_valid' as const, costClass: 'code' as const },
)

export default evaluate('examples.support-citations', {
  task: (input: SupportQuestion): SupportAnswer => ({
    answer: `Refund answers for "${input.question}" must cite the policy.`,
    citations: ['policy-refunds'],
  }),
  data: [
    {
      name: 'refund policy answer',
      input: { question: 'How do refunds work?' },
      expected: { requiredSources: ['policy-refunds'] },
    },
  ],
  scorers: [citationValid],
  assert: (ctx) => {
    ctx.expect(ctx.score.citation_valid).toBeGreaterThanOrEqual(0.7)
  },
})
