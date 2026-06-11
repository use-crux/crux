import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { flow } from '../../flow'
import { prompt } from '../../define'
import {
  cassette,
  expect as qExpect,
  quality,
  qualityMatcherRegistry,
  suite,
  target,
  type QualityScorer,
} from '../../quality'
import type { Retriever } from '../../retrieval'

function resultOk(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && 'ok' in value && value.ok === true)
}

function assertionMessage(run: () => void): string {
  try {
    run()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('Expected assertion to fail.')
}

function failedAssertion(message: string, source: 'expected' | 'expect' = 'expect') {
  return { passed: false, error: message, failures: [{ source, message }] }
}

describe('suite()', () => {
  it('creates Vitest-style quality suites and derives stable case ids', () => {
    const support = suite<{ question: string }>('support-tests', (test) => {
      test('answers Okta SSO', {
        input: { question: 'Why does Okta SSO fail?' },
        expect: ({ output }) => {
          expect(output).toBeDefined()
        },
      })
    })

    expect(support._tag).toBe('QualitySuite')
    expect(support.id).toBe('support-tests')
    expect(support.cases[0].id).toBe('answers-okta-sso')
    expect(support.cases[0].input.question).toBe('Why does Okta SSO fail?')
  })

  it('loads portable JSON suites', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-json-'))
    try {
      const path = join(dir, 'support.suite.json')
      await writeFile(
        path,
        JSON.stringify({
          id: 'support-json',
          cases: [{ id: 'refunds', input: { question: 'How do refunds work?' }, expected: { answer: '30 days' } }],
        }),
      )

      const support = await suite.json(path)

      expect(support.id).toBe('support-json')
      expect(support.source).toEqual({ kind: 'json', path })
      expect(support.cases[0].expected).toEqual({ answer: '30 days' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('exports code suites as portable JSON without runtime assertions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-export-'))
    try {
      const path = join(dir, 'support.suite.json')
      const support = suite<{ question: string }>('support-tests', (test) => {
        test('refund policy', {
          input: { question: 'How do refunds work?' },
          expected: { contains: 'refund' },
          tags: ['billing'],
          metadata: { priority: 'high' },
          expect: ({ output }) => {
            expect(output).toBeDefined()
          },
        })
      })

      const portable = suite.toJSON(support)
      await suite.writeJSON(support, path)

      expect(portable).toEqual({
        id: 'support-tests',
        cases: [
          {
            id: 'refund-policy',
            name: 'refund policy',
            input: { question: 'How do refunds work?' },
            expected: { contains: 'refund' },
            tags: ['billing'],
            metadata: { priority: 'high' },
          },
        ],
      })

      const reloaded = await suite.json(path)
      expect(reloaded.cases[0].expected).toEqual({ contains: 'refund' })
      expect(reloaded.cases[0].expect).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps the matcher registry aligned with live expect namespaces', () => {
    for (const [namespace, methods] of Object.entries(qualityMatcherRegistry)) {
      const factory = qExpect[namespace as keyof typeof qualityMatcherRegistry]
      expect(typeof factory).toBe('function')
      const matchers = factory({})
      for (const method of methods) {
        expect(typeof (matchers as Record<string, unknown>)[method]).toBe('function')
      }
    }
  })

  it('keeps the matcher registry documented in the Quality reference', async () => {
    const referencePath = join(process.cwd(), '../../apps/docs/content/docs/reference/crux-core/quality.mdx')
    const reference = await readFile(referencePath, 'utf8')

    for (const [namespace, methods] of Object.entries(qualityMatcherRegistry)) {
      expect(reference).toContain(namespace)
      for (const method of methods) expect(reference).toContain(method)
    }
  })

  it('keeps newer alias and predicate failure messages stable', () => {
    const source = {
      confidence: 0.4,
      toolCalls: [{ name: 'searchDocs', status: 'failed', result: { ok: false } }],
      _meta: { usage: { totalTokens: 900 }, durationMs: 700 },
    }

    expect([
      assertionMessage(() => qExpect.structuredOutput(source).toSatisfyField('confidence', () => false)),
      assertionMessage(() =>
        qExpect.structuredOutput(source).toSatisfyField('confidence', () => {
          throw new Error('boom')
        }),
      ),
      assertionMessage(() =>
        qExpect.toolResults(source).toSatisfyToolResult('searchDocs', () => {
          throw new Error('boom')
        }),
      ),
      assertionMessage(() => qExpect.toolResults(source).toHaveToolResultStatus('searchDocs', 'success')),
      assertionMessage(() => qExpect.budgets(source).toHaveTokenUsageBelow(500)),
    ]).toEqual([
      'Expected output field confidence to satisfy predicate.',
      'Expected output field confidence to satisfy predicate.',
      'Expected tool "searchDocs" result to satisfy predicate.',
      'Expected tool "searchDocs" result status "success".',
      'Expected token usage below 500, got 900.',
    ])
  })

  it('supports a Karyla-style deterministic suite using Vitest and Crux matchers together', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-karyla-smoke-'))
    try {
      const q = quality({ id: 'karyla-smoke', dir })
      type SmokeOutput = {
        answer: string
        confidence: number
        citations: readonly { sourceId: string; chunkId: string; quote?: string }[]
      }
      const smoke = suite<{ question: string }, SmokeOutput>('karyla-deterministic-smoke', (test) => {
        test('refund answer is deterministic and grounded', {
          input: { question: 'How do refunds work?' },
          expect: qExpect.all(
            (ctx) => qExpect(ctx.output.answer).toMatch(/refund/i),
            (ctx) => qExpect(ctx.output.answer).toContain('30 days'),
            (ctx) => qExpect(ctx.output.answer).not.toMatch(/maybe|probably/i),
            (ctx) => qExpect(ctx.output.confidence).toBeGreaterThanOrEqual(0.9),
            (ctx) =>
              qExpect.structuredOutput(ctx).toMatchSchema(
                z.object({
                  answer: z.string(),
                  confidence: z.number(),
                  citations: z.array(z.object({ sourceId: z.string(), chunkId: z.string() })),
                }),
              ),
            (ctx) => qExpect.structuredOutput(ctx).toSatisfyField('confidence', (value) => value === 0.94),
            (ctx) => qExpect.toolResults(ctx).toHaveToolResultStatus('searchDocs', 'success'),
            (ctx) => qExpect.toolResults(ctx).toSatisfyToolResult('searchDocs', resultOk),
            (ctx) => qExpect.grounding(ctx).toHaveCitationForSource('refunds.md'),
            (ctx) => qExpect.grounding(ctx).toQuoteOutput(),
            (ctx) => qExpect.budgets(ctx).toHaveTokenUsageBelow(500),
            (ctx) => qExpect.budgets(ctx).toHaveCostBelow(0.01),
            (ctx) => qExpect.contexts(ctx).toHaveIncludedContext('support-policy'),
            (ctx) => qExpect.contexts(ctx).toHaveNoDroppedContexts(),
          ),
        })
      })
      const evalTarget = target.custom({
        id: 'support-agent',
        run: () => ({
          answer: 'Refunds are available within 30 days.',
          confidence: 0.94,
          citations: [
            {
              sourceId: 'refunds.md',
              chunkId: 'refunds-1',
              quote: 'Refunds are available within 30 days',
            },
          ],
          toolCalls: [
            {
              name: 'searchDocs',
              args: { query: 'How do refunds work?' },
              status: 'success',
              result: { ok: true, sourceIds: ['refunds.md'] },
            },
          ],
          contexts: [{ id: 'support-policy', state: 'included', included: true, tokens: 220 }],
          _meta: {
            usage: { inputTokens: 120, outputTokens: 80 },
            cost: 0.002,
            durationMs: 320,
          },
        }),
      })

      const experiment = await q.evaluate({ id: 'karyla-smoke', suite: smoke, target: evalTarget })

      expect(experiment.status).toBe('passed')
      expect(experiment.cases[0].assertion).toEqual({ passed: true })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('passes normalized execution context to Vitest-like expectations for output, retrieval, tools, citations, artifacts, safety, state, routing, scoring, cache, compaction, embeddings, reliability, events, spans, contexts, and flow steps', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-expect-'))
    try {
      const q = quality({ id: 'support', dir })
      const support = suite<{ question: string }>('support-tests', (test) => {
        test('grounded answer uses docs and search tool', {
          input: { question: 'How do refunds work?' },
          expect: qExpect.all(
            (ctx) => {
              qExpect(ctx.caseId).toBe('grounded-answer-uses-docs-and-search-tool')
              qExpect(ctx.caseName).toBe('grounded answer uses docs and search tool')
              qExpect(ctx.variantId).toBe('default')
              qExpect(ctx.targetId).toBe('support-agent')
              qExpect(ctx.traceId).toBe('trace-refunds')
              qExpect(ctx.trace).toBeDefined()
              qExpect(ctx.input.question).toContain('refunds')
              qExpect(ctx.retrieval.hits[0]?.sourceId).toBe('refunds.md')
              qExpect(ctx.toolCalls[0]?.name).toBe('searchDocs')
              qExpect(ctx.toolCalls[0]?.status).toBe('success')
              qExpect(ctx.toolCalls[1]?.error).toMatchObject({ code: 'fallback_unavailable' })
              qExpect(ctx.steps[0]?.id).toBe('draft')
              qExpect(ctx.citations[0]?.sourceId).toBe('refunds.md')
              qExpect(ctx.handoffs[0]?.fromAgent).toBe('triage')
              qExpect(ctx.artifacts[0]?.path).toBe('/outputs/refund.md')
              qExpect(ctx.safety.guardrails[0]?.action).toBe('pass')
              qExpect(ctx.safety.constraints[0]?.name).toBe('citeSources')
              qExpect(ctx.memory[0]?.blockId).toBe('customerProfile')
              qExpect(ctx.workspace[0]?.path).toBe('/outputs/refund.md')
              qExpect(ctx.routing[0]?.selectedModel).toBe('gpt-quality')
              qExpect(ctx.scoring[0]?.score).toBeGreaterThanOrEqual(0.9)
              qExpect(ctx.cache[0]?.status).toBe('hit')
              qExpect(ctx.compaction[0]?.strategy).toBe('sliding-window')
              qExpect(ctx.embeddings[0]?.embeddingKind).toBe('dense')
              qExpect(ctx.retries[0]?.operation).toBe('generation')
              qExpect(ctx.latency[0]?.durationMs).toBeLessThan(500)
              qExpect(ctx.events[0]?.type).toBe('generation.start')
              qExpect(ctx.spans[0]?.name).toBe('support-agent')
              qExpect(ctx.contexts[0]?.id).toBe('support-policy')
            },
            ({ output }) => qExpect(output).toContain('30 days'),
            (ctx) => qExpect.retrieval(ctx).toContainHit({ sourceId: 'refunds.md', chunkId: 'refunds-1' }),
            (ctx) => qExpect.retrieval(ctx).toHaveHitCount(1),
            (ctx) => qExpect.retrieval(ctx).toHaveMinHitCount(1),
            (ctx) => qExpect.retrieval(ctx).toHaveMaxHitCount(2),
            (ctx) => qExpect.retrieval(ctx).toHaveTopHit({ sourceId: 'refunds.md', chunkId: 'refunds-1' }),
            (ctx) =>
              qExpect.output(ctx).toMatchSchema(
                z.object({
                  text: z.string(),
                  citations: z.array(z.object({ sourceId: z.string(), chunkId: z.string() })),
                }),
              ),
            (ctx) => qExpect.structuredOutput(ctx).toHaveValidJson(),
            (ctx) =>
              qExpect.structuredOutput(ctx).toMatchSchema(
                z.object({
                  text: z.string(),
                  citations: z.array(z.object({ sourceId: z.string(), chunkId: z.string() })),
                }),
              ),
            (ctx) => qExpect.output(ctx).toHaveField('citations.0.sourceId', 'refunds.md'),
            (ctx) =>
              qExpect
                .structuredOutput(ctx)
                .toHaveFieldMatching('citations.0.sourceId', (value) => value === 'refunds.md'),
            (ctx) =>
              qExpect.structuredOutput(ctx).toSatisfyField('citations.0.sourceId', (value) => value === 'refunds.md'),
            (ctx) => qExpect.output(ctx).toHaveNoField('citations.0.missingField'),
            (ctx) => qExpect.toolCalls(ctx).toHaveCalled('searchDocs'),
            (ctx) => qExpect.toolCalls(ctx).toHaveCalledWith('searchDocs', { query: 'refunds' }),
            (ctx) => qExpect.toolCalls(ctx).toHaveReturned('searchDocs'),
            (ctx) => qExpect.toolCalls(ctx).toHaveReturnedWith('searchDocs', { ok: true }),
            (ctx) => qExpect.toolCalls(ctx).toHaveFailed('fallbackSearch'),
            (ctx) => qExpect.toolCalls(ctx).toHaveCallSequence(['searchDocs', 'fallbackSearch']),
            (ctx) => qExpect.toolCalls(ctx).toHaveNoUnexpectedCalls(['searchDocs', 'fallbackSearch']),
            (ctx) => qExpect.toolCalls(ctx).toHaveCalledTimes('searchDocs', 1),
            (ctx) => qExpect.toolResults(ctx).toHaveToolResult('searchDocs'),
            (ctx) => qExpect.toolResults(ctx).toHaveToolResultStatus('searchDocs', 'success'),
            (ctx) => qExpect.toolResults(ctx).toHaveToolResultMatching('searchDocs', { ok: true }),
            (ctx) => qExpect.toolResults(ctx).toSatisfyToolResult('searchDocs', (result) => resultOk(result)),
            () =>
              qExpect
                .toolResults({ toolCalls: [{ name: 'searchDocs', status: 'success', result: { ok: true } }] })
                .toHaveNoFailedToolResults(),
            (ctx) => qExpect.steps(ctx).toHaveRun('draft'),
            (ctx) => qExpect.steps(ctx).toHaveSucceeded('draft'),
            (ctx) => qExpect.steps(ctx).toHaveFailed('review'),
            (ctx) => qExpect.steps(ctx).toHaveStepOrder(['draft', 'review']),
            (ctx) => qExpect.steps(ctx).toHaveOutput('draft', { text: 'Refunds are available within 30 days.' }),
            (ctx) => qExpect.steps(ctx).toHaveToolCall('draft', 'searchDocs'),
            (ctx) => qExpect.citations(ctx).toContainCitation({ sourceId: 'refunds.md', chunkId: 'refunds-1' }),
            (ctx) => qExpect.citations(ctx).toHaveCitationForSource('refunds.md'),
            (ctx) => qExpect.citations(ctx).toHaveAllCitationsResolved(),
            (ctx) => qExpect.citations(ctx).toHaveNoDanglingCitations(),
            (ctx) => qExpect.citations(ctx).toHaveMinimumQuoteLength(10),
            (ctx) => qExpect.citations(ctx).toQuoteOutput(),
            (ctx) => qExpect.grounding(ctx).toHaveCitationForSource('refunds.md'),
            (ctx) => qExpect.grounding(ctx).toHaveAllCitationsResolved(),
            (ctx) => qExpect.grounding(ctx).toHaveNoDanglingCitations(),
            (ctx) => qExpect.grounding(ctx).toHaveMinimumQuoteLength(10),
            (ctx) => qExpect.grounding(ctx).toQuoteOutput(),
            (ctx) => qExpect.usage(ctx).toHaveTokenUsageBelow(500),
            (ctx) => qExpect.usage(ctx).toHaveCostBelow(0.01),
            (ctx) => qExpect.usage(ctx).toHaveModel('gpt-quality'),
            (ctx) => qExpect.usage(ctx).toHaveNoFallback(),
            (ctx) => qExpect.budgets(ctx).toHaveTokenUsageBelow(500),
            (ctx) => qExpect.budgets(ctx).toHaveCostBelow(0.01),
            (ctx) => qExpect.budgets(ctx).toHaveLatencyBelow(500),
            (ctx) => qExpect.budgets(ctx).toHaveNoFallback(),
            () => qExpect.usage({ _meta: { fallback: { attempts: 2, failedModels: ['gpt-a'] } } }).toHaveUsedFallback(),
            (ctx) => qExpect.handoffs(ctx).toHaveHandoff({ fromAgent: 'triage', toAgent: 'billing' }),
            (ctx) => qExpect.handoffs(ctx).toHaveHandoffPath(['triage', 'billing']),
            (ctx) => qExpect.handoffs(ctx).toHaveHandoffCount(1),
            (ctx) => qExpect.artifacts(ctx).toHaveArtifact({ path: '/outputs/refund.md', kind: 'workspace.file' }),
            (ctx) => qExpect.artifacts(ctx).toHaveArtifactKind('workspace.file'),
            (ctx) => qExpect.artifacts(ctx).toHaveArtifactPath('/outputs/refund.md'),
            (ctx) => qExpect.artifacts(ctx).toHaveArtifactContent('/outputs/refund.md', /30 days/),
            (ctx) => qExpect.artifacts(ctx).toHaveArtifactCount(2),
            (ctx) => qExpect.safety(ctx).toHaveGuardrailAction('pii', 'pass'),
            (ctx) => qExpect.safety(ctx).toHaveNoBlockedGuardrails(),
            (ctx) => qExpect.safety(ctx).toHaveConstraintPassed('citeSources'),
            (ctx) => qExpect.safety(ctx).toHaveAllConstraintsPassed(),
            (ctx) => qExpect.safety(ctx).toHaveConstraintRetry('tone'),
            () =>
              qExpect
                .safety({ _meta: { guardrails: { applied: [{ guard: 'jailbreak', action: 'block' }] } } })
                .toHaveBlockedGuardrail('jailbreak'),
            () =>
              qExpect
                .safety({ _meta: { constraints: { entries: [{ constraint: 'tone', pass: false }] } } })
                .toHaveConstraintFailed('tone'),
            (ctx) => qExpect.memory(ctx).toHaveRead({ blockId: 'customerProfile' }),
            (ctx) => qExpect.memory(ctx).toHaveWritten({ blockId: 'caseNotes' }),
            (ctx) => qExpect.memory(ctx).toHaveMemoryOperation({ operation: 'write', blockId: 'caseNotes' }),
            (ctx) => qExpect.memory(ctx).toHaveMemoryValue('caseNotes', { summary: 'Refund answer drafted' }),
            (ctx) => qExpect.workspace(ctx).toHaveWritten('/outputs/refund.md'),
            (ctx) => qExpect.workspace(ctx).toHaveRead('/workspace/policy.md'),
            (ctx) => qExpect.workspace(ctx).toHaveListed('/workspace'),
            (ctx) => qExpect.workspace(ctx).toHaveNoWritesOutside(['/outputs/refund.md']),
            (ctx) => qExpect.routing(ctx).toHaveRoutingKind('router'),
            (ctx) => qExpect.routing(ctx).toHaveSelectedRoute('support'),
            (ctx) => qExpect.routing(ctx).toHaveClassifiedAs('refund'),
            (ctx) => qExpect.routing(ctx).toHaveSelectedModel('gpt-quality'),
            (ctx) => qExpect.routing(ctx).toHaveTierVerdict('gpt-quality', 'accepted'),
            (ctx) => qExpect.scoring(ctx).toHaveScoreAtLeast(0.9),
            (ctx) => qExpect.scoring(ctx).toHaveScoreBelow(1.1),
            (ctx) => qExpect.scoring(ctx).toHaveVerdict('pass'),
            (ctx) => qExpect.scoring(ctx).toHaveJudge('grounding', { status: 'passed', minScore: 0.9 }),
            (ctx) => qExpect.scoring(ctx).toHaveJudgePassed('grounding'),
            () =>
              qExpect
                .scoring({ scoring: [{ kind: 'score.report', judges: [{ name: 'tone', status: 'failed' }] }] })
                .toHaveJudgeFailed('tone'),
            (ctx) => qExpect.scoring(ctx).toHaveNoFailedJudges(),
            (ctx) => qExpect.cache(ctx).toHaveCacheStatus('hit', 'prompt'),
            (ctx) => qExpect.cache(ctx).toHaveCacheHit('prompt'),
            (ctx) => qExpect.cache(ctx).toHaveCacheMiss('retrieval'),
            (ctx) => qExpect.cache(ctx).toHaveCacheWrite('embedding'),
            (ctx) => qExpect.cache(ctx).toHaveCacheKey('support:refunds'),
            (ctx) => qExpect.cache(ctx).toHaveSavedTokensAtLeast(100),
            (ctx) => qExpect.compaction(ctx).toHaveCompacted(),
            (ctx) => qExpect.compaction(ctx).toHaveStrategy('sliding-window'),
            (ctx) => qExpect.compaction(ctx).toHaveTokenReductionAtLeast(500),
            (ctx) => qExpect.compaction(ctx).toHaveCompressionRatioBelow(0.6),
            (ctx) => qExpect.embeddings(ctx).toHaveEmbeddingKind('dense'),
            (ctx) => qExpect.embeddings(ctx).toHaveEmbeddingName('support-embedding'),
            (ctx) => qExpect.embeddings(ctx).toHaveInputCount(3),
            (ctx) => qExpect.embeddings(ctx).toHaveCacheHitRatioAtLeast(0.5),
            (ctx) => qExpect.embeddings(ctx).toHaveNoTruncation(),
            (ctx) => qExpect.embeddings(ctx).toHaveRetryCountBelow(2),
            (ctx) => qExpect.errors(ctx).toHaveErrorCode('review_required'),
            (ctx) => qExpect.errors(ctx).toHaveErrorMessage(/human review/),
            (ctx) => qExpect.errors(ctx).toHaveErrorPhase('review'),
            (ctx) => qExpect.retries(ctx).toHaveRetried('generation'),
            (ctx) => qExpect.retries(ctx).toHaveRetryCount(2, 'generation'),
            (ctx) => qExpect.retries(ctx).toHaveRetryCountBelow(3, 'generation'),
            () => qExpect.retries({ retries: [] }).toHaveNoRetries(),
            (ctx) => qExpect.latency(ctx).toHaveDurationBelow(500),
            (ctx) => qExpect.latency(ctx).toHaveOperationDurationBelow('generation', 300),
            (ctx) => qExpect.latency(ctx).toHaveMaxDurationBelow(500),
            (ctx) => qExpect.events(ctx).toHaveEvent('generation.delta'),
            (ctx) =>
              qExpect
                .events(ctx)
                .toHaveEventSequence(['generation.start', 'generation.delta', 'tool.call', 'generation.end']),
            (ctx) => qExpect.events(ctx).toHaveNoErrorEvents(),
            (ctx) => qExpect.events(ctx).toHaveFinalEvent('generation.end'),
            (ctx) => qExpect.events(ctx).toHaveChunkCountAtLeast(2),
            (ctx) => qExpect.spans(ctx).toHaveSpan('support-agent'),
            (ctx) => qExpect.spans(ctx).toHaveSpanStatus('generation', 'ok'),
            (ctx) => qExpect.spans(ctx).toHaveNoErrorSpans(),
            (ctx) => qExpect.spans(ctx).toHaveSpanChild('support-agent', 'generation'),
            (ctx) => qExpect.spans(ctx).toHaveSpanOrder(['support-agent', 'generation', 'searchDocs']),
            (ctx) => qExpect.spans(ctx).toHaveSpanDurationBelow('generation', 300),
            (ctx) => qExpect.contexts(ctx).toHaveIncludedContext('support-policy'),
            (ctx) => qExpect.contexts(ctx).toHaveExcludedContext('account-history'),
            (ctx) => qExpect.contexts(ctx).toHaveDroppedContext('legacy-faq'),
            () =>
              qExpect
                .contexts({ contexts: [{ id: 'support-policy', included: true, state: 'included' }] })
                .toHaveNoDroppedContexts(),
            (ctx) => qExpect.contexts(ctx).toHaveContextState('support-policy', 'included'),
            (ctx) => qExpect.contexts(ctx).toHaveContextTokenCountBelow('support-policy', 500),
          ),
        })
      })
      const evalTarget = target.custom({
        id: 'support-agent',
        run: () => ({
          text: 'Refunds are available within 30 days.',
          hits: [
            {
              namespace: 'support',
              sourceId: 'refunds.md',
              chunkId: 'refunds-1',
              content: 'Refund policy',
              metadata: {},
              score: 1,
            },
          ],
          toolCalls: [
            { name: 'searchDocs', args: { query: 'refunds' }, status: 'success', result: { ok: true } },
            {
              name: 'fallbackSearch',
              args: { query: 'refunds' },
              status: 'failed',
              error: { code: 'fallback_unavailable' },
            },
          ],
          steps: [
            {
              id: 'draft',
              status: 'completed',
              output: { text: 'Refunds are available within 30 days.' },
              toolCalls: [{ name: 'searchDocs', args: { query: 'refunds' }, status: 'success', result: { ok: true } }],
            },
            { id: 'review', status: 'failed', error: 'needs human review' },
          ],
          handoffs: [{ fromAgent: 'triage', toAgent: 'billing', reason: 'billing question', hopNumber: 1 }],
          handoffPath: ['triage', 'billing'],
          citations: [{ sourceId: 'refunds.md', chunkId: 'refunds-1', quote: 'Refunds are available within 30 days' }],
          artifacts: [
            {
              kind: 'workspace.file',
              name: 'refund.md',
              path: '/outputs/refund.md',
              contentType: 'text/markdown',
              content: 'Refunds are available within 30 days.',
              metadata: { purpose: 'final' },
            },
            {
              id: 'score-1',
              kind: 'score.report',
              name: 'grounding-score',
              preview: { score: 1 },
            },
          ],
          memory: {
            operations: [
              { operation: 'read', memoryId: 'support-memory', blockId: 'customerProfile', value: { tier: 'pro' } },
              {
                operation: 'write',
                memoryId: 'support-memory',
                blockId: 'caseNotes',
                value: { summary: 'Refund answer drafted' },
              },
            ],
          },
          workspace: {
            operations: [
              { operation: 'write', path: '/outputs/refund.md', status: 'ok', resultKind: 'file' },
              { operation: 'read', path: '/workspace/policy.md', status: 'ok', resultKind: 'file' },
              { operation: 'list', path: '/workspace', status: 'ok', resultKind: 'directory' },
            ],
          },
          routing: {
            kind: 'routing.report',
            routingKind: 'router',
            chosen: 'support',
            classifiedAs: 'refund',
            selectedModel: 'gpt-quality',
            tiers: [{ tier: 0, model: 'gpt-quality', verdict: 'accepted', confidence: 0.92 }],
          },
          scoring: {
            kind: 'score.report',
            verdict: 'pass',
            score: 0.96,
            rawScore: 0.96,
            reasoningPreview: 'Grounded answer with citations.',
            judges: [{ name: 'grounding', score: 0.96, threshold: 0.9, status: 'passed' }],
          },
          cache: [
            {
              kind: 'cache.report',
              cacheKind: 'prompt',
              status: 'hit',
              key: 'support:refunds',
              saved: { tokens: 128 },
            },
            { kind: 'cache.report', cacheKind: 'retrieval', status: 'miss', key: 'retrieval:refunds' },
            { kind: 'cache.report', cacheKind: 'embedding', status: 'write', key: 'embedding:refunds' },
          ],
          compaction: {
            kind: 'compaction.report',
            strategy: 'sliding-window',
            beforeTokens: 2400,
            afterTokens: 1200,
            compressionRatio: 0.5,
            summarizedPreview: 'Refund policy context.',
          },
          embeddings: [
            {
              kind: 'embedding.report',
              embeddingKind: 'dense',
              embeddingName: 'support-embedding',
              dimensions: 1536,
              inputCount: 3,
              chunkCount: 3,
              cacheHitCount: 2,
              cacheMissCount: 1,
              cacheHitRatio: 0.67,
              truncatedCount: 0,
              retryCount: 1,
            },
          ],
          errors: [{ code: 'review_required', message: 'needs human review', phase: 'review', retryable: false }],
          retries: [
            { kind: 'retry.report', operation: 'generation', attempt: 1, maxAttempts: 3, status: 'failed' },
            { kind: 'retry.report', operation: 'generation', attempt: 2, maxAttempts: 3, status: 'success' },
          ],
          latency: [
            { operation: 'generation', durationMs: 250 },
            { operation: 'retrieval', durationMs: 40 },
          ],
          events: [
            { type: 'generation.start', timestamp: '2026-01-01T00:00:00.000Z' },
            { type: 'generation.delta', data: { text: 'Refunds ' } },
            { type: 'generation.delta', data: { text: 'are available.' } },
            { type: 'tool.call', name: 'searchDocs', status: 'ok' },
            { type: 'generation.end', status: 'ok' },
          ],
          contexts: {
            contributions: [
              {
                id: 'support-policy',
                name: 'Support policy',
                state: 'included',
                included: true,
                priority: 90,
                tokens: 220,
              },
              {
                id: 'account-history',
                name: 'Account history',
                state: 'checked-not-included',
                included: false,
                reason: 'predicate',
                priority: 40,
                tokens: 0,
              },
              {
                id: 'legacy-faq',
                name: 'Legacy FAQ',
                state: 'budget-dropped',
                included: false,
                dropped: true,
                reason: 'budget',
                priority: 10,
                tokens: 620,
              },
            ],
          },
          _meta: {
            traceId: 'trace-refunds',
            trace: {
              spans: [
                { id: 'span-root', name: 'support-agent', status: 'ok', durationMs: 320 },
                { id: 'span-generation', parentId: 'span-root', name: 'generation', status: 'ok', durationMs: 250 },
                { id: 'span-tool', parentId: 'span-generation', name: 'searchDocs', status: 'ok', durationMs: 40 },
              ],
            },
            durationMs: 320,
            usage: { inputTokens: 120, outputTokens: 80 },
            cost: 0.002,
            actualModelId: 'gpt-quality',
            guardrails: {
              applied: [
                { guard: 'pii', phase: 'output', action: 'pass', durationMs: 1 },
                { guard: 'jailbreak', phase: 'input', action: 'warn', reason: 'reviewed', durationMs: 1 },
              ],
              blocked: false,
            },
            constraints: {
              entries: [
                { constraint: 'citeSources', severity: 'assert', pass: true, attempts: 1 },
                { constraint: 'tone', severity: 'suggest', pass: true, attempts: 2 },
              ],
              allPassed: true,
              suggestFallback: false,
            },
          },
        }),
      })

      const experiment = await q.evaluate({ id: 'expect-suite', suite: support, target: evalTarget })

      expect(experiment.cases[0].assertion).toEqual({ passed: true })
      expect(experiment.status).toBe('passed')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('supports Vitest-style numeric matchers and not chaining in suite expectations', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-numeric-expect-'))
    try {
      const q = quality({ id: 'metrics', dir })
      class MetricsEnvelope {
        constructor(readonly status: string) {}
      }
      const envelope = new MetricsEnvelope('passed')
      const metrics = suite<
        { id: string },
        {
          score: number
          tokens: bigint
          label: string
          optional?: string
          absent: null
          samples: readonly { name: string; value: number }[]
          meta: { owner: { team: string }; tags: readonly string[] }
          envelope: MetricsEnvelope
          invalidNumber: number
        }
      >('metrics-tests', (test) => {
        test('score and metadata are within deterministic bounds', {
          input: { id: 'case-1' },
          expect: ({ output }) => {
            qExpect(output.score).toBeGreaterThan(0.7)
            qExpect(output.score).toBeGreaterThanOrEqual(0.82)
            qExpect(output.score).toBeLessThan(1)
            qExpect(output.score).toBeLessThanOrEqual(0.82)
            qExpect(output.tokens).toBeGreaterThan(100n)
            qExpect(output.absent).toBeDefined()
            qExpect(output.optional).toBeUndefined()
            qExpect(output.absent).toBeNull()
            qExpect(output.label).toBeTruthy()
            qExpect(output.invalidNumber).toBeNaN()
            qExpect(false).toBeFalsy()
            qExpect(output.samples).toHaveLength(2)
            qExpect(output.samples).toContainEqual({ name: 'coverage', value: 1 })
            qExpect(output.meta).toMatchObject({ owner: { team: 'quality' } })
            qExpect(output.meta).toHaveProperty('owner.team', 'quality')
            qExpect(output.meta).toHaveProperty(['tags', 0], 'deterministic')
            qExpect(output.label).toBeTypeOf('string')
            qExpect(output.envelope).toBeInstanceOf(MetricsEnvelope)
            qExpect(output.envelope).toStrictEqual(envelope)
            qExpect(output.envelope).not.toStrictEqual({ status: 'passed' })
            qExpect(() => {
              throw new TypeError('bad metric')
            }).toThrow(TypeError)
            qExpect(() => {
              throw new Error('metric failed')
            }).toThrow(/metric/)
            qExpect(() => {
              throw new Error('metric failed')
            }).toThrow('failed')
            qExpect(() => 'ok').not.toThrow()
            qExpect(output.label).not.toBe('failed')
            qExpect(output.label).not.toContain('error')
            qExpect(output.label).not.toMatch(/failure/)
            qExpect(output.samples).not.toContainEqual({ name: 'coverage', value: 0 })
            qExpect(output.meta).not.toHaveProperty('owner.team', 'platform')
          },
        })
      })
      const evalTarget = target.custom({
        id: 'metrics-target',
        run: () => ({
          score: 0.82,
          tokens: 128n,
          label: 'passed',
          absent: null,
          samples: [
            { name: 'coverage', value: 1 },
            { name: 'latency', value: 42 },
          ],
          meta: { owner: { team: 'quality' }, tags: ['deterministic'] },
          envelope,
          invalidNumber: Number.NaN,
        }),
      })

      const experiment = await q.evaluate({ id: 'numeric-expect-suite', suite: metrics, target: evalTarget })

      expect(experiment.status).toBe('passed')
      expect(experiment.cases[0].assertion).toEqual({ passed: true })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('serializes numeric matcher assertion failures into experiment case results', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-numeric-failure-'))
    try {
      const q = quality({ id: 'metrics', dir })
      const metrics = suite<{ id: string }, { score: number }>('metrics-tests', (test) => {
        test('score clears threshold', {
          input: { id: 'case-1' },
          expect: ({ output }) => {
            qExpect(output.score).not.toBeLessThan(1)
          },
        })
      })
      const evalTarget = target.custom({
        id: 'metrics-target',
        run: () => ({ score: 0.82 }),
      })

      const experiment = await q.evaluate({ id: 'numeric-expect-failure', suite: metrics, target: evalTarget })

      expect(experiment.status).toBe('failed')
      expect(experiment.cases[0].status).toBe('failed')
      expect(experiment.cases[0].assertion).toEqual(failedAssertion('Expected 0.82 not to be < 1.'))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('serializes toThrow assertion failures into experiment case results', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-throw-failure-'))
    try {
      const q = quality({ id: 'metrics', dir })
      const metrics = suite<{ id: string }, { ok: boolean }>('metrics-tests', (test) => {
        test('function throws on invalid output', {
          input: { id: 'case-1' },
          expect: () => {
            qExpect(() => 'ok').toThrow('boom')
          },
        })
      })
      const evalTarget = target.custom({
        id: 'metrics-target',
        run: () => ({ ok: true }),
      })

      const experiment = await q.evaluate({ id: 'throw-expect-failure', suite: metrics, target: evalTarget })

      expect(experiment.status).toBe('failed')
      expect(experiment.cases[0].status).toBe('failed')
      expect(experiment.cases[0].assertion).toEqual(failedAssertion('Expected function to throw matching "boom".'))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('supports resolves and rejects chains in async suite expectations', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-async-expect-'))
    try {
      const q = quality({ id: 'async-metrics', dir })
      const metrics = suite<{ id: string }, { score: number; label: string }>('async-metrics-tests', (test) => {
        test('async assertions use promise matcher chains', {
          input: { id: 'case-1' },
          expect: async ({ output }) => {
            await qExpect(Promise.resolve(output.score)).resolves.toBeGreaterThanOrEqual(0.8)
            await qExpect(Promise.resolve(output.label)).resolves.not.toMatch(/failed/)
            await qExpect(Promise.resolve({ meta: { label: output.label } })).resolves.toHaveProperty(
              'meta.label',
              'passed',
            )
            await qExpect(Promise.reject(new TypeError('async metric failed'))).rejects.toThrow(TypeError)
            await qExpect(Promise.reject(new Error('async metric failed'))).rejects.toThrow(/metric/)
            await qExpect(Promise.reject({ code: 'E_METRIC' })).rejects.toMatchObject({ code: 'E_METRIC' })
            await qExpect(Promise.reject(new Error('async metric failed'))).rejects.not.toThrow('timeout')
          },
        })
      })
      const evalTarget = target.custom({
        id: 'async-metrics-target',
        run: () => ({ score: 0.82, label: 'passed' }),
      })

      const experiment = await q.evaluate({ id: 'async-expect-suite', suite: metrics, target: evalTarget })

      expect(experiment.status).toBe('passed')
      expect(experiment.cases[0].assertion).toEqual({ passed: true })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('serializes resolves and rejects assertion failures into experiment case results', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-async-failure-'))
    try {
      const q = quality({ id: 'async-metrics', dir })
      const metrics = suite<{ id: string }, { score: number }>('async-metrics-tests', (test) => {
        test('resolves assertion fails', {
          input: { id: 'case-1' },
          expect: async ({ output }) => {
            await qExpect(Promise.resolve(output.score)).resolves.toBeGreaterThanOrEqual(0.9)
          },
        })
        test('rejects assertion fails', {
          input: { id: 'case-2' },
          expect: async () => {
            await qExpect(Promise.resolve('ok')).rejects.toThrow('boom')
          },
        })
      })
      const evalTarget = target.custom({
        id: 'async-metrics-target',
        run: () => ({ score: 0.82 }),
      })

      const experiment = await q.evaluate({ id: 'async-expect-failure', suite: metrics, target: evalTarget })

      expect(experiment.status).toBe('failed')
      expect(experiment.cases[0].status).toBe('failed')
      expect(experiment.cases[0].assertion).toEqual(failedAssertion('Expected 0.82 to be >= 0.9.'))
      expect(experiment.cases[1].status).toBe('failed')
      expect(experiment.cases[1].assertion).toEqual(
        failedAssertion('Expected promise to reject, but it resolved with ok.'),
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('serializes Crux domain matcher failures into experiment case results', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-domain-failure-'))
    try {
      const q = quality({ id: 'domain', dir })
      const support = suite<{ question: string }, { text: string; toolCalls: readonly Record<string, unknown>[] }>(
        'domain-tests',
        (test) => {
          test('uses required tool', {
            input: { question: 'How do refunds work?' },
            expect: (ctx) => {
              qExpect.toolCalls(ctx).toHaveCalledWith('searchDocs', { query: 'refunds' })
            },
          })
        },
      )
      const evalTarget = target.custom({
        id: 'support-agent',
        run: () => ({
          text: 'Refunds are available within 30 days.',
          toolCalls: [{ name: 'searchDocs', args: { query: 'billing' }, result: { ok: true } }],
        }),
      })

      const experiment = await q.evaluate({ id: 'domain-expect-failure', suite: support, target: evalTarget })

      expect(experiment.status).toBe('failed')
      expect(experiment.cases[0].status).toBe('failed')
      expect(experiment.cases[0].assertion).toEqual(
        failedAssertion('Expected tool "searchDocs" to be called with args {"query":"refunds"}.'),
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('serializes artifact and safety matcher failures into experiment case results', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-artifact-safety-failure-'))
    try {
      const q = quality({ id: 'domain', dir })
      const support = suite<{ question: string }, { text: string; artifacts: readonly Record<string, unknown>[] }>(
        'artifact-safety-tests',
        (test) => {
          test('writes deliverable', {
            input: { question: 'How do refunds work?' },
            expect: (ctx) => qExpect.artifacts(ctx).toHaveArtifactPath('/outputs/refund.md'),
          })
          test('passes safety', {
            input: { question: 'How do refunds work?' },
            expect: (ctx) => qExpect.safety(ctx).toHaveNoBlockedGuardrails(),
          })
        },
      )
      const evalTarget = target.custom({
        id: 'support-agent',
        run: () => ({
          text: 'Refunds are available within 30 days.',
          artifacts: [{ kind: 'workspace.file', path: '/outputs/billing.md', content: 'Billing policy' }],
          _meta: { guardrails: { applied: [{ guard: 'pii', action: 'block', reason: 'PII detected' }] } },
        }),
      })

      const experiment = await q.evaluate({ id: 'artifact-safety-expect-failure', suite: support, target: evalTarget })

      expect(experiment.status).toBe('failed')
      expect(experiment.cases[0].status).toBe('failed')
      expect(experiment.cases[0].assertion).toEqual(failedAssertion('Expected artifact at path "/outputs/refund.md".'))
      expect(experiment.cases[1].status).toBe('failed')
      expect(experiment.cases[1].assertion).toEqual(failedAssertion('Expected no blocked guardrails, got 1.'))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('serializes memory, workspace, and routing matcher failures into experiment case results', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-state-routing-failure-'))
    try {
      const q = quality({ id: 'domain', dir })
      const support = suite<{ question: string }, { text: string }>('state-routing-tests', (test) => {
        test('writes case memory', {
          input: { question: 'How do refunds work?' },
          expect: (ctx) => qExpect.memory(ctx).toHaveWritten({ blockId: 'caseNotes' }),
        })
        test('writes deliverable', {
          input: { question: 'How do refunds work?' },
          expect: (ctx) => qExpect.workspace(ctx).toHaveWritten('/outputs/refund.md'),
        })
        test('routes to support', {
          input: { question: 'How do refunds work?' },
          expect: (ctx) => qExpect.routing(ctx).toHaveSelectedRoute('support'),
        })
      })
      const evalTarget = target.custom({
        id: 'support-agent',
        run: () => ({
          text: 'Refunds are available within 30 days.',
          memory: { operations: [{ operation: 'read', blockId: 'customerProfile' }] },
          workspace: { operations: [{ operation: 'write', path: '/outputs/billing.md' }] },
          routing: { kind: 'routing.report', routingKind: 'router', chosen: 'billing', selectedModel: 'gpt-quality' },
        }),
      })

      const experiment = await q.evaluate({ id: 'state-routing-expect-failure', suite: support, target: evalTarget })

      expect(experiment.status).toBe('failed')
      expect(experiment.cases.map((item) => item.assertion)).toEqual([
        failedAssertion('Expected memory write {"blockId":"caseNotes"}.'),
        failedAssertion('Expected workspace write at "/outputs/refund.md".'),
        failedAssertion('Expected selected route "support".'),
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('serializes scoring and cache matcher failures into experiment case results', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-scoring-cache-failure-'))
    try {
      const q = quality({ id: 'domain', dir })
      const support = suite<{ question: string }, { text: string }>('scoring-cache-tests', (test) => {
        test('passes grounding score', {
          input: { question: 'How do refunds work?' },
          expect: (ctx) => qExpect.scoring(ctx).toHaveScoreAtLeast(0.9),
        })
        test('uses prompt cache', {
          input: { question: 'How do refunds work?' },
          expect: (ctx) => qExpect.cache(ctx).toHaveCacheHit('prompt'),
        })
      })
      const evalTarget = target.custom({
        id: 'support-agent',
        run: () => ({
          text: 'Refunds are available within 30 days.',
          scoring: { kind: 'score.report', verdict: 'fail', score: 0.72 },
          cache: [{ kind: 'cache.report', cacheKind: 'prompt', status: 'miss', key: 'support:refunds' }],
        }),
      })

      const experiment = await q.evaluate({ id: 'scoring-cache-expect-failure', suite: support, target: evalTarget })

      expect(experiment.status).toBe('failed')
      expect(experiment.cases.map((item) => item.assertion)).toEqual([
        failedAssertion('Expected score at least 0.9.'),
        failedAssertion('Expected prompt cache status "hit".'),
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('serializes compaction and embedding matcher failures into experiment case results', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-compaction-embedding-failure-'))
    try {
      const q = quality({ id: 'domain', dir })
      const support = suite<{ question: string }, { text: string }>('compaction-embedding-tests', (test) => {
        test('uses sliding window compaction', {
          input: { question: 'How do refunds work?' },
          expect: (ctx) => qExpect.compaction(ctx).toHaveStrategy('sliding-window'),
        })
        test('embeds without truncation', {
          input: { question: 'How do refunds work?' },
          expect: (ctx) => qExpect.embeddings(ctx).toHaveNoTruncation(),
        })
      })
      const evalTarget = target.custom({
        id: 'support-agent',
        run: () => ({
          text: 'Refunds are available within 30 days.',
          compaction: {
            kind: 'compaction.report',
            strategy: 'none',
            beforeTokens: 100,
            afterTokens: 100,
            compressionRatio: 1,
          },
          embeddings: [{ kind: 'embedding.report', embeddingKind: 'dense', truncatedCount: 2 }],
        }),
      })

      const experiment = await q.evaluate({
        id: 'compaction-embedding-expect-failure',
        suite: support,
        target: evalTarget,
      })

      expect(experiment.status).toBe('failed')
      expect(experiment.cases.map((item) => item.assertion)).toEqual([
        failedAssertion('Expected compaction strategy "sliding-window".'),
        failedAssertion('Expected no embedding truncation, got 1 report(s).'),
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('serializes reliability matcher failures into experiment case results', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-reliability-failure-'))
    try {
      const q = quality({ id: 'domain', dir })
      const support = suite<{ question: string }, { text: string }>('reliability-tests', (test) => {
        test('has no hidden errors', {
          input: { question: 'How do refunds work?' },
          expect: (ctx) => qExpect.errors(ctx).toHaveNoErrors(),
        })
        test('keeps retry budget', {
          input: { question: 'How do refunds work?' },
          expect: (ctx) => qExpect.retries(ctx).toHaveRetryCountBelow(2, 'generation'),
        })
        test('keeps latency budget', {
          input: { question: 'How do refunds work?' },
          expect: (ctx) => qExpect.latency(ctx).toHaveOperationDurationBelow('generation', 300),
        })
      })
      const evalTarget = target.custom({
        id: 'support-agent',
        run: () => ({
          text: 'Refunds are available within 30 days.',
          errors: [{ code: 'timeout', message: 'generation timed out', phase: 'generation' }],
          retries: [
            { kind: 'retry.report', operation: 'generation', attempt: 1, status: 'failed' },
            { kind: 'retry.report', operation: 'generation', attempt: 2, status: 'failed' },
          ],
          latency: [{ operation: 'generation', durationMs: 450 }],
        }),
      })

      const experiment = await q.evaluate({ id: 'reliability-expect-failure', suite: support, target: evalTarget })

      expect(experiment.status).toBe('failed')
      expect(experiment.cases.map((item) => item.assertion)).toEqual([
        failedAssertion('Expected no errors, got 1.'),
        failedAssertion('Expected retry count for "generation" below 2, got 2.'),
        failedAssertion('Expected "generation" duration below 300ms.'),
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('serializes event matcher failures into experiment case results', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-event-failure-'))
    try {
      const q = quality({ id: 'domain', dir })
      const support = suite<{ question: string }, { text: string }>('event-tests', (test) => {
        test('streams answer deltas', {
          input: { question: 'How do refunds work?' },
          expect: (ctx) => qExpect.events(ctx).toHaveChunkCountAtLeast(2),
        })
        test('finishes cleanly', {
          input: { question: 'How do refunds work?' },
          expect: (ctx) => qExpect.events(ctx).toHaveNoErrorEvents(),
        })
        test('reaches terminal event', {
          input: { question: 'How do refunds work?' },
          expect: (ctx) => qExpect.events(ctx).toHaveFinalEvent('generation.end'),
        })
      })
      const evalTarget = target.custom({
        id: 'support-agent',
        run: () => ({
          text: 'Refunds are available within 30 days.',
          events: [
            { type: 'generation.start' },
            { type: 'generation.delta', data: { text: 'Refunds' } },
            { type: 'generation.error', status: 'error' },
          ],
        }),
      })

      const experiment = await q.evaluate({ id: 'event-expect-failure', suite: support, target: evalTarget })

      expect(experiment.status).toBe('failed')
      expect(experiment.cases.map((item) => item.assertion)).toEqual([
        failedAssertion('Expected at least 2 chunk event(s), got 1.'),
        failedAssertion('Expected no error events, got 1.'),
        failedAssertion('Expected final event "generation.end".'),
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('serializes span matcher failures into experiment case results', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-span-failure-'))
    try {
      const q = quality({ id: 'domain', dir })
      const support = suite<{ question: string }, { text: string }>('span-tests', (test) => {
        test('records generation span', {
          input: { question: 'How do refunds work?' },
          expect: (ctx) => qExpect.spans(ctx).toHaveSpan('generation'),
        })
        test('has clean spans', {
          input: { question: 'How do refunds work?' },
          expect: (ctx) => qExpect.spans(ctx).toHaveNoErrorSpans(),
        })
        test('keeps generation latency', {
          input: { question: 'How do refunds work?' },
          expect: (ctx) => qExpect.spans(ctx).toHaveSpanDurationBelow('generation', 300),
        })
      })
      const evalTarget = target.custom({
        id: 'support-agent',
        run: () => ({
          text: 'Refunds are available within 30 days.',
          _meta: {
            trace: {
              spans: [
                { id: 'root', name: 'support-agent', status: 'ok', durationMs: 500 },
                { id: 'tool', parentId: 'root', name: 'searchDocs', status: 'error', durationMs: 50 },
              ],
            },
          },
        }),
      })

      const experiment = await q.evaluate({ id: 'span-expect-failure', suite: support, target: evalTarget })

      expect(experiment.status).toBe('failed')
      expect(experiment.cases.map((item) => item.assertion)).toEqual([
        failedAssertion('Expected span "generation".'),
        failedAssertion('Expected no error spans, got 1.'),
        failedAssertion('Expected span "generation" duration below 300ms.'),
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('serializes context matcher failures into experiment case results', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-context-failure-'))
    try {
      const q = quality({ id: 'domain', dir })
      const support = suite<{ question: string }, { text: string }>('context-tests', (test) => {
        test('includes policy context', {
          input: { question: 'How do refunds work?' },
          expect: (ctx) => qExpect.contexts(ctx).toHaveIncludedContext('support-policy'),
        })
        test('has no budget drops', {
          input: { question: 'How do refunds work?' },
          expect: (ctx) => qExpect.contexts(ctx).toHaveNoDroppedContexts(),
        })
        test('keeps context compact', {
          input: { question: 'How do refunds work?' },
          expect: (ctx) => qExpect.contexts(ctx).toHaveContextTokenCountBelow('legacy-faq', 500),
        })
      })
      const evalTarget = target.custom({
        id: 'support-agent',
        run: () => ({
          text: 'Refunds are available within 30 days.',
          contexts: [
            { id: 'support-policy', state: 'checked-not-included', included: false, reason: 'predicate', tokens: 0 },
            {
              id: 'legacy-faq',
              state: 'budget-dropped',
              included: false,
              dropped: true,
              reason: 'budget',
              tokens: 620,
            },
          ],
        }),
      })

      const experiment = await q.evaluate({ id: 'context-expect-failure', suite: support, target: evalTarget })

      expect(experiment.status).toBe('failed')
      expect(experiment.cases.map((item) => item.assertion)).toEqual([
        failedAssertion('Expected included context "support-policy".'),
        failedAssertion('Expected no dropped contexts, got 1.'),
        failedAssertion('Expected context "legacy-faq" token count below 500.'),
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('serializes tool result, structured output, grounding, and budget matcher failures', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-agentic-failure-'))
    try {
      const q = quality({ id: 'domain', dir })
      const support = suite<{ question: string }, unknown>('agentic-tests', (test) => {
        test('tool result succeeded', {
          input: { question: 'How do refunds work?' },
          expect: (ctx) => qExpect.toolResults(ctx).toHaveToolResultStatus('searchDocs', 'success'),
        })
        test('tool result matched payload', {
          input: { question: 'How do refunds work?' },
          expect: (ctx) => qExpect.toolResults(ctx).toHaveToolResultMatching('searchDocs', { ok: true }),
        })
        test('structured output is json', {
          input: { question: 'How do refunds work?' },
          expect: (ctx) => qExpect.structuredOutput(ctx).toHaveValidJson(),
        })
        test('structured output satisfies predicate', {
          input: { question: 'How do refunds work?' },
          expect: (ctx) => qExpect.structuredOutput(ctx).toSatisfyField('confidence', (value) => value === 1),
        })
        test('tool result satisfies predicate', {
          input: { question: 'How do refunds work?' },
          expect: (ctx) => qExpect.toolResults(ctx).toSatisfyToolResult('searchDocs', (result) => resultOk(result)),
        })
        test('answer is grounded', {
          input: { question: 'How do refunds work?' },
          expect: (ctx) => qExpect.grounding(ctx).toHaveCitationForSource('refunds.md'),
        })
        test('stays within budget', {
          input: { question: 'How do refunds work?' },
          expect: (ctx) => qExpect.budgets(ctx).toHaveTokenUsageBelow(500),
        })
      })
      const evalTarget = target.custom({
        id: 'support-agent',
        run: () => ({
          text: 'Refunds are available within 30 days.',
          format: () => 'not-json',
          confidence: 0.4,
          toolCalls: [{ name: 'searchDocs', status: 'failed', result: { ok: false } }],
          citations: [],
          _meta: { usage: { totalTokens: 900 }, cost: 0.02, durationMs: 700 },
        }),
      })

      const experiment = await q.evaluate({ id: 'agentic-expect-failure', suite: support, target: evalTarget })

      expect(experiment.status).toBe('failed')
      expect(experiment.cases.map((item) => item.assertion)).toEqual([
        failedAssertion('Expected tool "searchDocs" result status "success".'),
        failedAssertion('Expected tool "searchDocs" result to match {"ok":true}.'),
        failedAssertion('Expected output to be valid JSON.'),
        failedAssertion('Expected output field confidence to satisfy predicate.'),
        failedAssertion('Expected tool "searchDocs" result to satisfy predicate.'),
        failedAssertion('Expected citation for source "refunds.md".'),
        failedAssertion('Expected token usage below 500, got 900.'),
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('target()', () => {
  it('creates a custom executable target', async () => {
    const assistant = target<{ question: string }, { answer: string }>({
      id: 'support-agent',
      run: ({ question }) => ({ answer: `Answer: ${question}` }),
    })

    await expect(Promise.resolve(assistant.run({ question: 'Can I get a refund?' }))).resolves.toEqual({
      answer: 'Answer: Can I get a refund?',
    })
  })

  it('creates a prompt target with prompt input inference', async () => {
    const supportPrompt = prompt({
      id: 'support',
      input: z.object({ question: z.string() }),
      output: z.object({ answer: z.string() }),
      system: 'Answer support questions.',
    })

    const support = target.prompt({
      prompt: supportPrompt,
      generate: async (_prompt, input) => ({ answer: `Generated: ${input.question}` }),
    })

    await expect(support.run({ question: 'How do refunds work?' })).resolves.toEqual({
      answer: 'Generated: How do refunds work?',
    })
    expect(support.id).toBe('support')
  })

  it('creates a retriever target that maps case input into retrieval queries', async () => {
    const calls: string[] = []
    const docs: Retriever = {
      _tag: 'Retriever',
      id: 'docs',
      namespace: 'support',
      mode: 'custom',
      retrieve: async (query) => {
        calls.push(query)
        return [
          {
            namespace: 'support',
            sourceId: 'refunds.md',
            chunkId: 'refunds-1',
            content: `Hit for ${query}`,
            metadata: {},
            score: 1,
          },
        ]
      },
      asContext: () => {
        throw new Error('not used')
      },
      asTools: () => ({}),
      inject: () => ({}),
    }

    const docsTarget = target.retriever<{ question: string }>(docs, {
      query: ({ question }) => question,
    })

    const hits = await docsTarget.run({ question: 'refund policy' })

    expect(calls).toEqual(['refund policy'])
    expect(hits[0].sourceId).toBe('refunds.md')
    expect(docsTarget.id).toBe('docs')
  })

  it('creates a flow target that returns completed flow output', async () => {
    const supportFlow = flow<{ answer: string }, { question: string }>('support-flow', (scope) => ({
      answer: `Flow: ${scope.input.question}`,
    }))

    const support = target.flow(supportFlow)

    await expect(support.run({ question: 'Can I get a refund?' })).resolves.toEqual({
      answer: 'Flow: Can I get a refund?',
    })
    expect(support.id).toBe('support-flow')
  })
})

describe('quality().evaluate()', () => {
  it('persists a single-target experiment to the local quality directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-'))
    try {
      const q = quality({ id: 'support', dir })
      const support = suite<{ question: string }>('support-tests', (test) => {
        test('refund policy', {
          input: { question: 'Can I get a refund?' },
          expect: ({ output }) => {
            expect(output.answer).toContain('30 days')
          },
        })
      })
      const evalTarget = target.custom<{ question: string }, { answer: string }>({
        id: 'support-agent',
        run: async () => ({ answer: 'Refunds are available within 30 days.' }),
      })

      const experiment = await q.evaluate({
        id: 'support-v1',
        suite: support,
        target: evalTarget,
      })

      expect(experiment._tag).toBe('Experiment')
      expect(experiment.status).toBe('passed')
      expect(experiment.summary.passed).toBe(1)
      expect(experiment.variants).toEqual([{ id: 'default', targetId: 'support-agent' }])

      const stored = JSON.parse(await readFile(join(dir, 'experiments', 'support-v1.json'), 'utf8')) as {
        id: string
        cases: Array<{ output: { answer: string } }>
      }
      expect(stored.id).toBe('support-v1')
      expect(stored.cases[0].output.answer).toContain('30 days')
      await expect(q.getExperiment('support-v1')).resolves.toMatchObject({ id: 'support-v1' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('records usage, cost, and trace ids from adapter-shaped target results', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-metadata-'))
    try {
      const q = quality({ id: 'support', dir })
      const support = suite<{ question: string }>('support-tests', (test) => {
        test('refund policy', { input: { question: 'Can I get a refund?' } })
      })
      const evalTarget = target.custom({
        id: 'support-agent',
        run: () => ({
          text: 'Refunds are available within 30 days.',
          usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
          _meta: { cost: 0.0042, traceId: 'trace-1' },
        }),
      })

      const experiment = await q.evaluate({
        id: 'support-metadata',
        suite: support,
        target: evalTarget,
      })

      expect(experiment.cases[0]).toMatchObject({
        usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
        cost: 0.0042,
        traceId: 'trace-1',
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('runs variant experiments and records scorer failures by variant', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-variants-'))
    try {
      const q = quality({ id: 'support', dir })
      const support = suite<{ question: string }>('support-tests', (test) => {
        test('refund policy', {
          input: { question: 'Can I get a refund?' },
        })
      })
      const containsRefund: QualityScorer<{ question: string }, { answer: string }> = {
        id: 'contains-refund',
        score: ({ output }) => ({
          kind: 'boolean',
          name: 'contains-refund',
          passed: output.answer.toLowerCase().includes('refund'),
        }),
      }

      const experiment = await q.evaluate({
        id: 'support-model-bakeoff',
        suite: support,
        baseline: 'good',
        variants: {
          good: {
            target: target.custom({
              id: 'good-agent',
              run: () => ({ answer: 'Refunds are available within 30 days.' }),
            }),
          },
          bad: {
            target: target.custom({
              id: 'bad-agent',
              run: () => ({ answer: 'Please contact support.' }),
            }),
          },
        },
        scorers: [containsRefund],
      })

      expect(experiment.status).toBe('failed')
      expect(experiment.baselineVariantId).toBe('good')
      expect(experiment.summary.byVariant.good).toMatchObject({ total: 1, passed: 1 })
      expect(experiment.summary.byVariant.bad).toMatchObject({ total: 1, failed: 1 })
      expect(experiment.cases.find((item) => item.variantId === 'bad')?.scores[0]).toMatchObject({
        kind: 'boolean',
        passed: false,
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('evaluates portable expected contains checks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-expected-'))
    try {
      const q = quality({ id: 'support', dir })
      const support = suite<{ question: string }>('support-tests', (test) => {
        test('refund policy passes', {
          input: { question: 'Can I get a refund?' },
          expected: { contains: '30 days' },
        })
        test('refund policy fails', {
          input: { question: 'Can I get a refund?' },
          expected: { contains: 'wire transfer' },
        })
      })
      const evalTarget = target.custom<{ question: string }, { answer: string }>({
        id: 'support-agent',
        run: () => ({ answer: 'Refunds are available within 30 days.' }),
      })

      const experiment = await q.evaluate({ id: 'expected-checks', suite: support, target: evalTarget })

      expect(experiment.summary).toMatchObject({ total: 2, passed: 1, failed: 1 })
      expect(experiment.cases[0].assertion).toEqual({ passed: true })
      expect(experiment.cases[1].assertion?.passed).toBe(false)
      expect(experiment.cases[1].assertion?.error).toContain('wire transfer')
      expect(experiment.cases[1].assertion).toEqual(
        failedAssertion('Expected output to contain "wire transfer" for expected.contains.', 'expected'),
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('lists persisted experiments newest first', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-list-'))
    try {
      const q = quality({ id: 'support', dir })
      const support = suite<{ question: string }>('support-tests', (test) => {
        test('smoke', { input: { question: 'Can I get a refund?' } })
      })
      const evalTarget = target.custom<{ question: string }, { answer: string }>({
        id: 'support-agent',
        run: () => ({ answer: 'Refunds are available within 30 days.' }),
      })

      await q.evaluate({ id: 'older', suite: support, target: evalTarget })
      await new Promise((resolve) => setTimeout(resolve, 5))
      await q.evaluate({ id: 'newer', suite: support, target: evalTarget })

      const experiments = await q.listExperiments()

      expect(experiments.map((experiment) => experiment.id)).toEqual(['newer', 'older'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('compares two persisted experiments and records pass-rate deltas', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-compare-'))
    try {
      const q = quality({ id: 'support', dir })
      const support = suite<{ question: string }>('support-tests', (test) => {
        test('refund policy', {
          input: { question: 'Can I get a refund?' },
          expected: { contains: 'refund' },
        })
        test('sso policy', {
          input: { question: 'How do I configure SSO?' },
          expected: { contains: 'SSO' },
        })
      })

      await q.evaluate({
        id: 'baseline',
        suite: support,
        target: target.custom({
          id: 'baseline-agent',
          run: ({ question }) => ({ answer: question.includes('refund') ? 'refund' : 'not sure' }),
        }),
      })
      await q.evaluate({
        id: 'candidate',
        suite: support,
        target: target.custom({
          id: 'candidate-agent',
          run: ({ question }) => ({ answer: question.includes('refund') ? 'refund' : 'SSO setup' }),
        }),
      })

      const comparison = await q.compare({
        id: 'candidate-vs-baseline',
        baseline: 'baseline',
        candidate: 'candidate',
        gates: {
          passRate: { minDelta: 0.75 },
        },
      })

      expect(comparison._tag).toBe('QualityComparison')
      expect(comparison.status).toBe('candidate_better')
      expect(comparison.metrics.passRateDelta).toBe(0.5)
      expect(comparison.gates?.status).toBe('failed')
      expect(comparison.gates?.results[0]).toMatchObject({
        name: 'passRate.minDelta',
        passed: false,
      })
      expect(comparison.baseline.passRate).toBe(0.5)
      expect(comparison.candidate.passRate).toBe(1)
      await expect(q.getComparison('candidate-vs-baseline')).resolves.toMatchObject({
        id: 'candidate-vs-baseline',
        metrics: { passRateDelta: 0.5 },
      })
      await expect(q.listComparisons()).resolves.toHaveLength(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('promotes an experiment variant to a named baseline', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-promote-'))
    try {
      const q = quality({ id: 'support', dir })
      const support = suite<{ question: string }>('support-tests', (test) => {
        test('refund policy', { input: { question: 'Can I get a refund?' } })
      })

      const experiment = await q.evaluate({
        id: 'support-v2',
        suite: support,
        baseline: 'mini',
        variants: {
          mini: {
            target: target.custom({
              id: 'mini-agent',
              run: () => ({ answer: 'refund' }),
            }),
          },
        },
      })

      const baseline = await q.promote({
        id: 'current-support',
        experiment,
        variantId: 'mini',
        label: 'Current support baseline',
      })

      expect(baseline).toMatchObject({
        _tag: 'QualityBaseline',
        id: 'current-support',
        experimentId: 'support-v2',
        variantId: 'mini',
        label: 'Current support baseline',
      })
      await expect(q.getBaseline('current-support')).resolves.toMatchObject({ experimentId: 'support-v2' })
      await expect(q.listBaselines()).resolves.toHaveLength(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('records and replays deterministic cassette entries for quality evaluations', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-cassette-'))
    try {
      const q = quality({ id: 'support', dir })
      const cassettePath = join(dir, 'cassettes', 'support.cassette.json')
      const support = suite<{ question: string }>('support-tests', (test) => {
        test('refund policy', { input: { question: 'Can I get a refund?' } })
      })
      let calls = 0
      const evalTarget = target.custom<{ question: string }, { answer: string }>({
        id: 'support-agent',
        run: ({ question }) => {
          calls++
          return { answer: `live: ${question}` }
        },
      })

      const recorded = await q.evaluate({
        id: 'recorded',
        suite: support,
        target: evalTarget,
        replay: cassette.record(cassettePath),
      })
      const replayed = await q.evaluate({
        id: 'replayed',
        suite: support,
        target: evalTarget,
        replay: cassette.replay(cassettePath),
      })

      expect(calls).toBe(1)
      expect(recorded.cases[0].output).toEqual({ answer: 'live: Can I get a refund?' })
      expect(replayed.cases[0].output).toEqual({ answer: 'live: Can I get a refund?' })

      const fixture = JSON.parse(await readFile(cassettePath, 'utf8')) as {
        entries: Array<{ request: { caseId?: string } }>
      }
      expect(fixture.entries).toHaveLength(1)
      expect(fixture.entries[0].request.caseId).toBe('refund-policy')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('wraps adapter middleware calls as cassette boundaries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-cassette-middleware-'))
    try {
      const cassettePath = join(dir, 'cassettes', 'adapter.cassette.json')
      const args = {
        promptId: 'support',
        operation: 'generate' as const,
        preparedArgs: {
          messages: [{ role: 'user', content: 'Can I get a refund?' }],
          temperature: 0,
        },
        input: { question: 'Can I get a refund?' },
        provider: 'test',
        model: 'mini',
        outputMode: 'text' as const,
      }
      let calls = 0

      const record = cassette.middleware(cassette.record(cassettePath, { cases: ['refund-policy'] }), {
        caseId: 'refund-policy',
      })
      const recorded = await record(args, async () => {
        calls++
        return { text: 'Refunds are available within 30 days.' }
      })

      const replay = cassette.middleware(cassette.replay(cassettePath), {
        caseId: 'refund-policy',
      })
      const replayed = await replay(args, async () => {
        calls++
        return { text: 'live call should not run' }
      })

      expect(calls).toBe(1)
      expect(recorded.text).toBe('Refunds are available within 30 days.')
      expect(replayed.text).toBe('Refunds are available within 30 days.')

      const fixture = JSON.parse(await readFile(cassettePath, 'utf8')) as {
        entries: Array<{ request: { kind: string; provider?: string; model?: string; caseId?: string } }>
      }
      expect(fixture.entries[0].request).toMatchObject({
        kind: 'generate',
        provider: 'test',
        model: 'mini',
        caseId: 'refund-policy',
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('records retriever targets as retrieval cassette boundaries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-retriever-cassette-'))
    try {
      const q = quality({ id: 'support', dir })
      const cassettePath = join(dir, 'cassettes', 'docs.cassette.json')
      const support = suite<{ query: string }>('support-tests', (test) => {
        test('refund retrieval', { input: { query: 'refund policy' } })
      })
      const docs: Retriever = {
        _tag: 'Retriever',
        id: 'docs',
        namespace: 'support',
        mode: 'custom',
        retrieve: async (query) => [
          {
            namespace: 'support',
            sourceId: 'refunds.md',
            chunkId: 'refunds-1',
            content: query,
            metadata: {},
            score: 1,
          },
        ],
        asContext: () => {
          throw new Error('not used')
        },
        asTools: () => ({}),
        inject: () => ({}),
      }

      await q.evaluate({
        id: 'retriever-recorded',
        suite: support,
        target: target.retriever(docs),
        replay: cassette.record(cassettePath),
      })

      const fixture = JSON.parse(await readFile(cassettePath, 'utf8')) as {
        entries: Array<{ request: { kind: string } }>
      }
      expect(fixture.entries[0].request.kind).toBe('retrieve')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('fails closed in CI cassette mode when an entry is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-cassette-ci-'))
    try {
      const q = quality({ id: 'support', dir })
      const support = suite<{ question: string }>('support-tests', (test) => {
        test('refund policy', { input: { question: 'Can I get a refund?' } })
      })
      const evalTarget = target.custom<{ question: string }, { answer: string }>({
        id: 'support-agent',
        run: () => ({ answer: 'live' }),
      })

      await expect(
        q.evaluate({
          id: 'ci-missing',
          suite: support,
          target: evalTarget,
          replay: cassette.ci(join(dir, 'missing.cassette.json')),
        }),
      ).resolves.toMatchObject({
        status: 'error',
        summary: { errored: 1 },
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('quality().feedback', () => {
  it('records append-only feedback and redacts configured metadata paths', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-feedback-'))
    try {
      const q = quality({
        id: 'support',
        dir,
        privacy: {
          redact: ['metadata.user.email'],
        },
      })

      const feedback = await q.feedback.record({
        traceId: 'trace-1',
        rating: -1,
        comment: 'The answer cited the wrong source.',
        expected: {
          sources: [{ sourceId: 'pricing.md' }],
        },
        tags: ['retrieval', 'citation'],
        metadata: {
          user: { email: 'private@example.com' },
          priority: 'high',
        },
      })

      expect(feedback).toMatchObject({
        _tag: 'QualityFeedback',
        qualityId: 'support',
        traceId: 'trace-1',
        rating: -1,
        status: 'new',
        comment: 'The answer cited the wrong source.',
        expected: {
          sources: [{ sourceId: 'pricing.md' }],
        },
        tags: ['retrieval', 'citation'],
      })
      expect(feedback.metadata).toEqual({
        user: { email: '[redacted]' },
        priority: 'high',
      })

      const feedbackItems = await q.feedback.list()
      expect(feedbackItems).toHaveLength(1)
      expect(feedbackItems[0].id).toBe(feedback.id)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('exports selected feedback to a portable suite with explicit input', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-feedback-export-'))
    try {
      const q = quality({ id: 'support', dir })
      const feedback = await q.feedback.record({
        rating: -1,
        expected: { contains: 'SAML' },
        tags: ['auth'],
      })

      const portable = await q.feedback.exportSuite({
        id: 'support-regressions',
        feedbackIds: [feedback.id],
        inputs: {
          [feedback.id]: { question: 'How do I configure SSO?' },
        },
        tag: 'regression',
      })

      expect(portable).toEqual({
        id: 'support-regressions',
        cases: [
          {
            id: feedback.id,
            input: { question: 'How do I configure SSO?' },
            expected: { contains: 'SAML' },
            tags: ['auth', 'regression'],
          },
        ],
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps linked trace metadata but requires explicit input for portable feedback export', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-feedback-trace-export-'))
    try {
      const q = quality({ id: 'support', dir })
      const feedback = await q.feedback.record({
        traceId: 'trace-1',
        caseId: 'okta-sso-regression',
        rating: -1,
        expected: { sources: [{ sourceId: 'sso.md' }] },
      })

      const portable = await q.feedback.exportSuite({
        id: 'support-regressions',
        feedbackIds: [feedback.id],
        inputs: {
          [feedback.id]: { question: 'Why did Okta SSO fail?' },
        },
        tag: 'regression',
        includeFeedbackMetadata: true,
      })

      expect(portable.cases[0]).toMatchObject({
        id: 'okta-sso-regression',
        input: { question: 'Why did Okta SSO fail?' },
        expected: { sources: [{ sourceId: 'sso.md' }] },
        tags: ['regression'],
        metadata: {
          qualityFeedbackId: feedback.id,
          traceId: 'trace-1',
          rating: -1,
        },
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('fails clearly when exported feedback has no explicit input', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-feedback-missing-input-'))
    try {
      const q = quality({ id: 'support', dir })
      const feedback = await q.feedback.record({
        expected: { contains: 'refund' },
      })

      await expect(
        q.feedback.exportSuite({
          id: 'support-regressions',
          feedbackIds: [feedback.id],
        }),
      ).rejects.toThrow(/Provide inputs/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('records append-only feedback annotations for review state and expected fields', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-feedback-annotations-'))
    try {
      const q = quality({ id: 'support', dir })
      const feedback = await q.feedback.record({
        traceId: 'trace-1',
        rating: -1,
        comment: 'Wrong source cited.',
      })

      const annotation = await q.feedback.annotate({
        feedbackId: feedback.id,
        status: 'reviewed',
        note: 'Promoted to auth regressions.',
        expected: { sources: [{ sourceId: 'sso.md' }] },
        tags: ['auth', 'regression'],
      })

      expect(annotation).toMatchObject({
        _tag: 'QualityFeedbackAnnotation',
        qualityId: 'support',
        feedbackId: feedback.id,
        status: 'reviewed',
        note: 'Promoted to auth regressions.',
        expected: { sources: [{ sourceId: 'sso.md' }] },
        tags: ['auth', 'regression'],
      })
      await expect(q.feedback.listAnnotations(feedback.id)).resolves.toHaveLength(1)
      await expect(q.feedback.listAnnotations()).resolves.toHaveLength(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('records append-only feedback memory proposals without writing memory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-feedback-memory-'))
    try {
      const q = quality({
        id: 'support',
        dir,
        privacy: {
          redact: ['proposal.user.email', 'metadata.reviewer.email'],
        },
      })
      const feedback = await q.feedback.record({
        traceId: 'trace-1',
        rating: -1,
        comment: 'Remember the user prefers short answers.',
      })

      const proposal = await q.feedback.proposeMemory({
        feedbackId: feedback.id,
        memoryId: 'user-preferences',
        memoryKind: 'semantic',
        proposal: {
          preference: 'short answers',
          user: { email: 'private@example.com' },
        },
        reason: 'Reviewer marked the response as too verbose.',
        tags: ['memory', 'preference'],
        metadata: {
          reviewer: { email: 'qa@example.com' },
        },
      })

      expect(proposal).toMatchObject({
        _tag: 'QualityFeedbackMemoryProposal',
        qualityId: 'support',
        feedbackId: feedback.id,
        status: 'proposed',
        memoryId: 'user-preferences',
        memoryKind: 'semantic',
        proposal: {
          preference: 'short answers',
          user: { email: '[redacted]' },
        },
        reason: 'Reviewer marked the response as too verbose.',
        tags: ['memory', 'preference'],
        metadata: {
          reviewer: { email: '[redacted]' },
        },
      })
      await expect(q.feedback.listMemoryProposals(feedback.id)).resolves.toHaveLength(1)
      await expect(q.feedback.listMemoryProposals()).resolves.toHaveLength(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('fails clearly when proposing memory for unknown feedback', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-feedback-memory-missing-'))
    try {
      const q = quality({ id: 'support', dir })

      await expect(
        q.feedback.proposeMemory({
          feedbackId: 'missing-feedback',
          proposal: { preference: 'short answers' },
        }),
      ).rejects.toThrow(/feedback "missing-feedback" was not found/i)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

async function writeFileWithParents(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}
