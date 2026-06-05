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
    expect: ({
      input,
      output,
      retrieval,
      toolCalls,
      steps,
      citations,
      artifacts,
      safety,
      memory,
      workspace,
      routing,
      scoring,
      cache,
      compaction,
      embeddings,
      errors,
      retries,
      latency,
      traceId,
      trace,
    }) => {
      expectTypeOf(input.locale).toEqualTypeOf<'en' | 'nl'>()
      expectTypeOf(output.answer).toEqualTypeOf<string>()
      expectTypeOf(retrieval.hits).toEqualTypeOf<readonly Record<string, unknown>[]>()
      const toolCall = toolCalls[0]
      if (toolCall) expectTypeOf(toolCall.name).toEqualTypeOf<string>()
      const step = steps[0]
      if (step) expectTypeOf(step.status).toEqualTypeOf<string | undefined>()
      const citation = citations[0]
      if (citation) expectTypeOf(citation.sourceId).toEqualTypeOf<string>()
      const artifact = artifacts[0]
      if (artifact) expectTypeOf(artifact.path).toEqualTypeOf<string | undefined>()
      const guardrail = safety.guardrails[0]
      if (guardrail) expectTypeOf(guardrail.action).toEqualTypeOf<string>()
      const constraint = safety.constraints[0]
      if (constraint) expectTypeOf(constraint.name).toEqualTypeOf<string>()
      const memoryOperation = memory[0]
      if (memoryOperation) expectTypeOf(memoryOperation.operation).toEqualTypeOf<string>()
      const workspaceOperation = workspace[0]
      if (workspaceOperation) expectTypeOf(workspaceOperation.operation).toEqualTypeOf<string>()
      const routingReport = routing[0]
      if (routingReport)
        expectTypeOf(routingReport.tiers).toEqualTypeOf<
          readonly {
            readonly tier?: number
            readonly model?: string
            readonly verdict?: string
            readonly confidence?: number
          }[]
        >()
      const scoringReport = scoring[0]
      if (scoringReport) expectTypeOf(scoringReport.score).toEqualTypeOf<number | undefined>()
      const cacheReport = cache[0]
      if (cacheReport) expectTypeOf(cacheReport.status).toEqualTypeOf<string>()
      const compactionReport = compaction[0]
      if (compactionReport) expectTypeOf(compactionReport.strategy).toEqualTypeOf<string>()
      const embeddingReport = embeddings[0]
      if (embeddingReport) expectTypeOf(embeddingReport.embeddingKind).toEqualTypeOf<string | undefined>()
      const errorReport = errors[0]
      if (errorReport) expectTypeOf(errorReport.message).toEqualTypeOf<string>()
      const retryReport = retries[0]
      if (retryReport) expectTypeOf(retryReport.attempt).toEqualTypeOf<number>()
      const latencyReport = latency[0]
      if (latencyReport) expectTypeOf(latencyReport.durationMs).toEqualTypeOf<number>()
      expectTypeOf(traceId).toEqualTypeOf<string | undefined>()
      expectTypeOf(trace).toEqualTypeOf<unknown>()
      qualityExpect.output({ output }).toMatchSchema(z.object({ answer: z.string() }))
      qualityExpect.output({ output }).toHaveField('answer')
      qualityExpect.output({ output }).toHaveNoField('missing')
      qualityExpect
        .toolCalls({
          toolCalls: [{ name: 'searchDocs', args: { query: 'refunds' }, result: { ok: true } }],
        })
        .toHaveCalledWith('searchDocs', { query: 'refunds' })
      qualityExpect
        .toolCalls({
          toolCalls: [{ name: 'searchDocs', args: { query: 'refunds' }, result: { ok: true } }],
        })
        .toHaveReturnedWith('searchDocs', { ok: true })
      qualityExpect
        .toolCalls({
          toolCalls: [{ name: 'fallbackSearch', status: 'failed', error: 'disabled' }],
        })
        .toHaveFailed('fallbackSearch')
      qualityExpect
        .toolCalls({
          toolCalls: [{ name: 'searchDocs' }, { name: 'answer' }],
        })
        .toHaveCallSequence(['searchDocs', 'answer'])
      qualityExpect
        .toolCalls({
          toolCalls: [{ name: 'searchDocs' }],
        })
        .toHaveNoUnexpectedCalls(['searchDocs'])
      qualityExpect
        .steps({
          steps: [
            {
              id: 'draft',
              status: 'completed',
              output: { answer: 'refund' },
              toolCalls: [{ name: 'searchDocs' }],
            },
          ],
        })
        .toHaveRun('draft')
      qualityExpect
        .steps({
          steps: [{ id: 'draft', status: 'completed', output: { answer: 'refund' } }],
        })
        .toHaveOutput('draft', { answer: 'refund' })
      qualityExpect
        .steps({
          steps: [{ id: 'draft', status: 'completed', toolCalls: [{ name: 'searchDocs' }] }],
        })
        .toHaveToolCall('draft', 'searchDocs')
      qualityExpect
        .citations({ citations: [{ sourceId: 'refunds.md', quote: 'Refund policy' }] })
        .toHaveCitationForSource('refunds.md')
      qualityExpect
        .citations({ citations: [{ sourceId: 'refunds.md', quote: 'Refund policy' }] })
        .toHaveAllCitationsResolved()
      qualityExpect
        .usage({
          _meta: { usage: { inputTokens: 10, outputTokens: 5 }, cost: 0.001, actualModelId: 'test-model' },
        })
        .toHaveTokenUsageBelow(20)
      qualityExpect
        .usage({
          _meta: { usage: { inputTokens: 10, outputTokens: 5 }, cost: 0.001, actualModelId: 'test-model' },
        })
        .toHaveModel('test-model')
      qualityExpect
        .artifacts({
          artifacts: [{ kind: 'workspace.file', path: '/outputs/refund.md', content: 'Refund policy' }],
        })
        .toHaveArtifactPath('/outputs/refund.md')
      qualityExpect
        .artifacts({
          artifacts: [{ kind: 'workspace.file', path: '/outputs/refund.md', content: 'Refund policy' }],
        })
        .toHaveArtifactContent('/outputs/refund.md', /Refund/)
      qualityExpect
        .safety({
          _meta: { guardrails: { applied: [{ guard: 'pii', action: 'pass' }] } },
        })
        .toHaveGuardrailAction('pii', 'pass')
      qualityExpect
        .safety({
          _meta: { constraints: { entries: [{ constraint: 'citeSources', pass: true, attempts: 1 }] } },
        })
        .toHaveConstraintPassed('citeSources')
      qualityExpect
        .memory({ memory: { operations: [{ operation: 'write', blockId: 'caseNotes', value: { ok: true } }] } })
        .toHaveWritten({ blockId: 'caseNotes' })
      qualityExpect
        .workspace({ workspace: { operations: [{ operation: 'write', path: '/outputs/refund.md' }] } })
        .toHaveWritten('/outputs/refund.md')
      qualityExpect
        .routing({ routing: { kind: 'routing.report', routingKind: 'router', chosen: 'support' } })
        .toHaveSelectedRoute('support')
      qualityExpect
        .scoring({
          scoring: {
            kind: 'score.report',
            verdict: 'pass',
            score: 0.95,
            judges: [{ name: 'grounding', status: 'passed', score: 0.95 }],
          },
        })
        .toHaveJudgePassed('grounding')
      qualityExpect
        .cache({ cache: [{ kind: 'cache.report', cacheKind: 'prompt', status: 'hit', key: 'support:refunds' }] })
        .toHaveCacheHit('prompt')
      qualityExpect
        .compaction({
          compaction: {
            kind: 'compaction.report',
            strategy: 'sliding-window',
            beforeTokens: 100,
            afterTokens: 50,
            compressionRatio: 0.5,
          },
        })
        .toHaveStrategy('sliding-window')
      qualityExpect
        .embeddings({
          embeddings: [
            {
              kind: 'embedding.report',
              embeddingKind: 'dense',
              embeddingName: 'support',
              inputCount: 1,
              truncatedCount: 0,
              retryCount: 0,
            },
          ],
        })
        .toHaveNoTruncation()
      qualityExpect
        .errors({ errors: [{ code: 'timeout', message: 'generation timed out', phase: 'generation' }] })
        .toHaveErrorCode('timeout')
      qualityExpect
        .retries({ retries: [{ kind: 'retry.report', operation: 'generation', attempt: 1 }] })
        .toHaveRetryCount(1, 'generation')
      qualityExpect
        .latency({ latency: [{ operation: 'generation', durationMs: 120 }] })
        .toHaveOperationDurationBelow('generation', 200)
    },
  })

  test('typed numeric assertions', {
    input: { question: 'Are refunds good?', locale: 'en' },
    expect: async () => {
      qualityExpect(2).toBeGreaterThan(1)
      qualityExpect(2).toBeGreaterThanOrEqual(2)
      qualityExpect(2).toBeLessThan(3)
      qualityExpect(2).toBeLessThanOrEqual(2)
      qualityExpect(2n).not.toBeLessThan(1n)
      qualityExpect('refund').toBeTruthy()
      qualityExpect('').toBeFalsy()
      qualityExpect(null).toBeDefined()
      qualityExpect(null).toBeNull()
      qualityExpect(undefined).toBeUndefined()
      qualityExpect(Number.NaN).toBeNaN()
      qualityExpect(['refund']).toHaveLength(1)
      qualityExpect([{ answer: 'refund' }]).toContainEqual({ answer: 'refund' })
      qualityExpect({ answer: 'refund' }).toStrictEqual({ answer: 'refund' })
      qualityExpect({ answer: { text: 'refund' } }).toMatchObject({ answer: { text: 'refund' } })
      qualityExpect({ answer: { text: 'refund' } }).toHaveProperty('answer.text', 'refund')
      qualityExpect('refund').toBeTypeOf('string')
      qualityExpect(new Date()).toBeInstanceOf(Date)
      qualityExpect(() => {
        throw new Error('refund')
      }).toThrow(Error)
      qualityExpect(() => {
        throw new Error('refund')
      }).toThrow(/refund/)
      qualityExpect(() => undefined).not.toThrow()
      await qualityExpect(Promise.resolve({ answer: 'refund' })).resolves.toStrictEqual({ answer: 'refund' })
      await qualityExpect(Promise.resolve('refund')).resolves.not.toMatch(/billing/)
      await qualityExpect(Promise.reject(new Error('refund'))).rejects.toThrow(Error)
      await qualityExpect(Promise.reject({ code: 'refund' })).rejects.toMatchObject({ code: 'refund' })
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
        qualityExpect.retrieval(ctx).toHaveMinHitCount(1)
        qualityExpect.retrieval(ctx).toHaveMaxHitCount(2)
        qualityExpect.retrieval(ctx).toHaveTopHit({ sourceId: 'refunds.md' })
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
