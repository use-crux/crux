import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { flow } from '../../flow'
import { prompt } from '../../define'
import { cassette, expect as qExpect, quality, suite, target, type QualityScorer } from '../../quality'
import type { Retriever } from '../../retrieval'

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

  it('passes normalized execution context to Vitest-like expectations for output, retrieval, tools, citations, and flow steps', async () => {
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
              qExpect(ctx.steps[0]?.id).toBe('draft')
              qExpect(ctx.citations[0]?.sourceId).toBe('refunds.md')
              qExpect(ctx.handoffs[0]?.fromAgent).toBe('triage')
            },
            ({ output }) => qExpect(output).toContain('30 days'),
            (ctx) => qExpect.retrieval(ctx).toContainHit({ sourceId: 'refunds.md', chunkId: 'refunds-1' }),
            (ctx) => qExpect.retrieval(ctx).toHaveHitCount(1),
            (ctx) => qExpect.toolCalls(ctx).toHaveCalled('searchDocs'),
            (ctx) => qExpect.toolCalls(ctx).toHaveCalledTimes('searchDocs', 1),
            (ctx) => qExpect.steps(ctx).toHaveSucceeded('draft'),
            (ctx) => qExpect.citations(ctx).toContainCitation({ sourceId: 'refunds.md', chunkId: 'refunds-1' }),
            (ctx) => qExpect.handoffs(ctx).toHaveHandoff({ fromAgent: 'triage', toAgent: 'billing' }),
            (ctx) => qExpect.handoffs(ctx).toHaveHandoffPath(['triage', 'billing']),
            (ctx) => qExpect.handoffs(ctx).toHaveHandoffCount(1),
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
          toolCalls: [{ name: 'searchDocs', args: { query: 'refunds' }, result: { ok: true } }],
          steps: [{ id: 'draft', status: 'completed', output: { text: 'Refunds are available within 30 days.' } }],
          handoffs: [{ fromAgent: 'triage', toAgent: 'billing', reason: 'billing question', hopNumber: 1 }],
          handoffPath: ['triage', 'billing'],
          citations: [{ sourceId: 'refunds.md', chunkId: 'refunds-1', quote: 'Refunds are available within 30 days' }],
          _meta: { traceId: 'trace-refunds', trace: { spans: [{ name: 'support-agent' }] } },
        }),
      })

      const experiment = await q.evaluate({ id: 'expect-suite', suite: support, target: evalTarget })

      expect(experiment.cases[0].assertion).toEqual({ passed: true })
      expect(experiment.status).toBe('passed')
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

      const fixture = JSON.parse(await readFile(cassettePath, 'utf8')) as { entries: Array<{ request: { caseId?: string } }> }
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

      const fixture = JSON.parse(await readFile(cassettePath, 'utf8')) as { entries: Array<{ request: { kind: string } }> }
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
