/**
 * Type tests for the public Quality API. These are intentionally written from a
 * user perspective: a suite defines case inputs, targets infer their accepted
 * input, and quality.evaluate() rejects mismatched combinations at compile time.
 */

import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { prompt } from '../define'
import { expect as qualityExpect, quality, suite, target } from '../quality'
import { retriever } from '../retrieval'

const supportPrompt = prompt({
  id: 'support',
  input: z.object({ question: z.string(), locale: z.enum(['en', 'nl']) }),
  output: z.object({ answer: z.string() }),
  system: 'Answer support questions.',
})

const supportSuite = suite<{ question: string; locale: 'en' | 'nl' }, { answer: string }>('support', (test) => {
  test('refund policy', {
    input: { question: 'How do refunds work?', locale: 'en' },
    expect: ({ output }) => {
      qualityExpect(output.answer).toContain('refund')
    },
  })

  test('typed assertion', {
    input: { question: 'Hoe werken refunds?', locale: 'nl' },
    expect: ({ input, output, retrieval, toolCalls, steps, citations, traceId, trace }) => {
      expectTypeOf(input.locale).toEqualTypeOf<'en' | 'nl'>()
      expectTypeOf(output.answer).toEqualTypeOf<string>()
      expectTypeOf(retrieval.hits).toEqualTypeOf<readonly Record<string, unknown>[]>()
      const toolCall = toolCalls[0]
      if (toolCall) expectTypeOf(toolCall.name).toEqualTypeOf<string>()
      const step = steps[0]
      if (step) expectTypeOf(step.status).toEqualTypeOf<string | undefined>()
      const citation = citations[0]
      if (citation) expectTypeOf(citation.sourceId).toEqualTypeOf<string>()
      expectTypeOf(traceId).toEqualTypeOf<string | undefined>()
      expectTypeOf(trace).toEqualTypeOf<unknown>()
    },
  })

  test('typed assertion composition', {
    input: { question: 'Do refunds work?', locale: 'en' },
    expect: qualityExpect.all<{ question: string; locale: 'en' | 'nl' }, { answer: string }>(
      (ctx) => {
        expectTypeOf(ctx.output.answer).toEqualTypeOf<string>()
      },
      (ctx) => {
        qualityExpect(ctx.input.locale).toBe('en')
      },
    ),
  })

  test('missing locale is rejected', {
    // @ts-expect-error — suite case input must match the suite input type.
    input: { question: 'How do refunds work?' },
  })
})

const supportTarget = target.prompt({
  prompt: supportPrompt,
  generate: async (_prompt, input) => {
    expectTypeOf(input.question).toEqualTypeOf<string>()
    expectTypeOf(input.locale).toEqualTypeOf<'en' | 'nl'>()
    // @ts-expect-error — prompt target input is inferred from the prompt schema.
    input.unknownField
    return { answer: `Answer for ${input.question}` }
  },
})

const docsRetriever = retriever({
  id: 'docs',
  namespace: 'support',
  retrieve: async (query) => [
    {
      namespace: 'support',
      sourceId: `${query}.md`,
      chunkId: 'chunk-1',
      content: 'Refund policy',
      metadata: {},
      score: 1,
    },
  ],
})

const docsSuite = suite<{ query: string; visibility: 'public' | 'internal' }, readonly { sourceId: string }[]>(
  'docs',
  (test) => {
  test('public docs', {
    input: { query: 'refunds', visibility: 'public' },
    expect: (ctx) => {
      qualityExpect.retrieval(ctx).toContainHit({ sourceId: 'refunds.md' })
      qualityExpect.retrieval(ctx).toHaveHitCount(1)
    },
  })
  },
)

const docsTarget = target.retriever(docsRetriever, {
  query: (input: { query: string; visibility: 'public' | 'internal' }) => input.query,
  options: (input) => ({ filter: { visibility: input.visibility } }),
})

const q = quality({ id: 'support', dir: '.crux/quality' })

void q.evaluate({
  suite: supportSuite,
  target: supportTarget,
})

void q.evaluate({
  suite: docsSuite,
  target: docsTarget,
})

void q.evaluate({
  // @ts-expect-error — suite input and output must be compatible with the target.
  suite: docsSuite,
  // @ts-expect-error — target output must match the typed suite expectation output.
  target: supportTarget,
})
