import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { prompt } from '../../prompt/prompt'
import { agent } from '../../agent/agent'
import { flow } from '../../flow/scope'
import { observe } from '../../observability'
import { evaluate, target } from '../../quality'
import type { GenerateFn } from '../../quality/target'
import { createQualityRunner } from '../../quality/internal/runner'
import { runEvaluationWithRunner as run } from './runner-harness'

const supportPrompt = prompt({
  id: 'support',
  input: z.object({ question: z.string() }),
  output: z.object({ answer: z.string() }),
  system: 'Answer support questions.',
})

const textPrompt = prompt({
  id: 'haiku',
  input: z.object({ topic: z.string() }),
  system: 'Write a haiku.',
})

const supportAgent = agent({ id: 'support-agent', prompt: supportPrompt })

/** A span-emitting helper simulating what real adapters/primitives emit. */
async function emitSignalSpans(): Promise<void> {
  await observe.span(
    {
      name: 'generate support',
      primitive: 'generation.call',
      attributes: { model: 'stub-model', provider: 'stub' },
    },
    async () => {
      observe.event({ name: 'usage.observed', attributes: { inputTokens: 10, outputTokens: 5, costUsd: 0.002 } })
    },
  )
  await observe.span(
    { name: 'search', primitive: 'tool.call', attributes: { toolName: 'search' } },
    async () => {
      observe.artifact({
        kind: 'tool.args',
        contentType: 'application/json',
        encoding: 'json',
        preview: { query: 'refunds' },
      })
      observe.artifact({
        kind: 'tool.result',
        contentType: 'application/json',
        encoding: 'json',
        preview: [{ id: 'docs/refunds' }],
      })
    },
  )
  await observe.span(
    { name: 'lookupOrder', primitive: 'tool.call', attributes: { toolName: 'lookupOrder' } },
    async () => {},
  )
  await observe.span(
    { name: 'plan', primitive: 'flow.step', attributes: { stepLabel: 'plan' } },
    async () => {
      observe.artifact({
        kind: 'output',
        contentType: 'application/json',
        encoding: 'json',
        preview: { goal: 'answer refunds' },
      })
    },
  )
  await observe.span({ name: 'handoff', primitive: 'handoff.prepare' }, async () => {
    observe.artifact({
      kind: 'handoff.payload',
      contentType: 'application/json',
      encoding: 'json',
      preview: { kind: 'handoff.payload', fromAgent: 'support-agent', toAgent: 'billing' },
    })
  })
  await observe.span({ name: 'retrieve', primitive: 'retrieval.query' }, async () => {
    observe.artifact({
      kind: 'retrieval.hits',
      contentType: 'application/json',
      encoding: 'json',
      preview: {
        kind: 'retrieval.hits',
        query: 'refunds',
        returned: 2,
        hits: [
          { rank: 1, sourceId: 'docs/refunds', chunkId: 'c1', score: 0.92 },
          { rank: 2, sourceId: 'docs/shipping', chunkId: 'c2', score: 0.4 },
        ],
      },
    })
  })
  await observe.span({ name: 'citations', primitive: 'citation.check' }, async () => {
    observe.artifact({
      kind: 'citation.report',
      contentType: 'application/json',
      encoding: 'json',
      preview: {
        kind: 'citation.report',
        markers: [{ marker: '[1]', sourceId: 'docs/refunds', grounded: true, outputQuote: 'within 14 days' }],
      },
    })
  })
  await observe.span(
    { name: 'pii', primitive: 'guardrail.run', attributes: { guardrailId: 'pii' } },
    async () => {
      observe.artifact({
        kind: 'guardrail.report',
        contentType: 'application/json',
        encoding: 'json',
        preview: { kind: 'guardrail.report', action: 'pass' },
      })
    },
  )
  await observe.span(
    { name: 'tone', primitive: 'constraint.check', attributes: { constraintId: 'tone' } },
    async () => {
      observe.artifact({
        kind: 'constraint.report',
        contentType: 'application/json',
        encoding: 'json',
        preview: { kind: 'constraint.report', constraint: 'tone', pass: true },
      })
    },
  )
  await observe.span(
    { name: 'profile.read', primitive: 'memory.read', attributes: { key: 'profile' } },
    async () => {},
  )
  await observe.span(
    { name: 'summary.write', primitive: 'memory.write', attributes: { key: 'summary' } },
    async () => {
      observe.artifact({
        kind: 'memory.diff',
        contentType: 'application/json',
        encoding: 'json',
        preview: { kind: 'memory.diff', blockKind: 'working', operation: 'write', after: { note: 'done' } },
      })
    },
  )
  await observe.span({ name: 'route', primitive: 'routing.router' }, async () => {
    observe.artifact({
      kind: 'routing.report',
      contentType: 'application/json',
      encoding: 'json',
      preview: {
        kind: 'routing.report',
        routingKind: 'router',
        chosen: 'support',
        classifiedAs: 'billing-question',
        selectedModel: 'stub-model',
      },
    })
  })
}

/** Stub generate that emits the full signal families, then answers. */
const emittingGenerate = (async (_prompt: never, _opts: never) => {
  await emitSignalSpans()
  return { object: { answer: 'refunds resolve within 14 days' } }
}) as GenerateFn

/** Stub generate that answers without emitting any signal. */
const silentGenerate = (async (_prompt: never, _opts: never) => ({
  object: { answer: 'no signals here' },
})) as GenerateFn

const agentCases = [{ input: { question: 'How do refunds work?' } }]

describe('trace-backed signals — captured-pass for every namespace', () => {
  it('asserts across all nine namespaces plus always-on from one rich execution', async () => {
    const evaluation = evaluate({
      task: target.agent(supportAgent, { generate: emittingGenerate }),
      data: agentCases,
      expect: (ctx) => {
        // value matchers on output
        ctx.expect(ctx.output.answer).toContain('14 days')
        // modelCalls
        ctx.expect.modelCalls.count().toBe(1)
        ctx.expect.modelCalls.toHaveUsedModel('stub-model')
        ctx.expect.modelCalls.toHaveNoFallback()
        // toolCalls
        ctx.expect.toolCalls.toHaveCalled('search', { query: 'refunds' })
        ctx.expect.toolCalls.toHaveCalledAll(['search', 'lookupOrder'])
        ctx.expect.toolCalls.toHaveCalledBefore('search', 'lookupOrder')
        ctx.expect.toolCalls.toMatchTrajectory('superset', [{ tool: 'search' }])
        ctx.expect.toolCalls.toMatchTrajectory('subset', [
          { tool: 'search' },
          { tool: 'lookupOrder' },
          { tool: 'other' },
        ])
        ctx.expect.toolCalls.toHaveAllSucceeded()
        ctx.expect.toolCalls.not.toHaveCalled('deleteAccount')
        ctx.expect.toolCalls.count().toBe(2)
        // steps
        ctx.expect.steps.toHaveRun('plan')
        ctx.expect.steps.toHaveSucceeded('plan')
        ctx.expect.steps.toHaveOrder('plan')
        ctx.expect.steps.count().toBeGreaterThanOrEqual(1)
        // step access with schema narrowing
        const plan = ctx.step('plan', z.object({ goal: z.string() }))
        ctx.expect(plan.output.goal).toBe('answer refunds')
        ctx.expect(plan.status).toBe('succeeded')
        // handoffs
        ctx.expect.handoffs.toHaveHandedOffTo('billing')
        ctx.expect.handoffs.toHavePath('billing')
        ctx.expect.handoffs.count().toBe(1)
        // retrieval
        ctx.expect.retrieval.toContainHit({ sourceId: 'docs/refunds' })
        ctx.expect.retrieval.toHaveTopHit({ sourceId: 'docs/refunds' })
        ctx.expect.retrieval.count().toBe(2)
        // citations
        ctx.expect.citations.toCite('docs/refunds')
        ctx.expect.citations.toAllResolve()
        ctx.expect.citations.toHaveNoDangling()
        ctx.expect.citations.toQuoteOutput({ minLength: 5 })
        ctx.expect.citations.count().toBe(1)
        // safety
        ctx.expect.safety.toHavePassedGuardrails()
        ctx.expect.safety.toHavePassedConstraint('tone')
        ctx.expect.safety.toHaveAllConstraintsPassed()
        // memory
        ctx.expect.memory.toHaveRead('profile')
        ctx.expect.memory.toHaveWritten('summary')
        ctx.expect.memory.toHaveValue('summary', { note: 'done' })
        // routing
        ctx.expect.routing.toHaveSelected('support')
        ctx.expect.routing.toHaveClassifiedAs('billing-question')
        ctx.expect.routing.toHaveSelectedModel('stub-model')
        // always-on
        ctx.expect.latency.toBeUnderMs(60_000)
        ctx.expect.latency.p95().toBeGreaterThanOrEqual(0)
        ctx.expect.cost.toBeUnderUsd(0.01)
        ctx.expect.cost.toHaveModel('stub-model')
        ctx.expect.cost.toHaveNoFallback()
        ctx.expect.errors.toHaveNone()
        ctx.expect.errors.toHaveRetriedAtMost(0)
      },
    })

    const experiment = await run(evaluation)
    const cell = experiment.cells[0]!
    expect(cell.assertions.outcomes.filter((outcome) => outcome.status === 'failed' || outcome.status === 'uncaptured')).toEqual([])
    expect(cell.status).toBe('passed')
    expect(cell.capturedSignals.sort()).toEqual(
      ['citations', 'handoffs', 'memory', 'modelCalls', 'retrieval', 'routing', 'safety', 'steps', 'toolCalls'].sort(),
    )
    // Cost/usage flow from the usage.observed event into the cell record.
    expect(cell.costUsd).toBeCloseTo(0.002, 6)
    expect(cell.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      inputTokenDetails: {},
      outputTokenDetails: {},
    })
  })
})

describe('trace-backed signals — uncaptured assertions fail loudly (never vacuous)', () => {
  const namespaces: Array<{
    name: string
    assert: (ctx: { expect: Record<string, never> }) => void
  }> = [
    {
      name: 'modelCalls',
      assert: (ctx) => (ctx.expect.modelCalls as { count(): { toBe(n: number): void } }).count().toBe(0),
    },
    {
      name: 'toolCalls',
      assert: (ctx) => (ctx.expect.toolCalls as { toHaveCalled(t: string): void }).toHaveCalled('search'),
    },
    { name: 'steps', assert: (ctx) => (ctx.expect.steps as { toHaveRun(n: string): void }).toHaveRun('plan') },
    {
      name: 'handoffs',
      assert: (ctx) => (ctx.expect.handoffs as { count(): { toBe(n: number): void } }).count().toBe(0),
    },
    {
      name: 'retrieval',
      assert: (ctx) => (ctx.expect.retrieval as { count(): { toBe(n: number): void } }).count().toBe(0),
    },
    { name: 'citations', assert: (ctx) => (ctx.expect.citations as { toAllResolve(): void }).toAllResolve() },
    {
      name: 'safety',
      assert: (ctx) => (ctx.expect.safety as { toHavePassedGuardrails(): void }).toHavePassedGuardrails(),
    },
    { name: 'memory', assert: (ctx) => (ctx.expect.memory as { toHaveRead(): void }).toHaveRead() },
    {
      name: 'routing',
      assert: (ctx) => (ctx.expect.routing as { toHaveSelected(r: string): void }).toHaveSelected('x'),
    },
  ]

  for (const namespace of namespaces) {
    it(`expect.${namespace.name} on an execution that captured no ${namespace.name} signal fails with guidance`, async () => {
      const evaluation = evaluate({
        task: target.agent(supportAgent, { generate: silentGenerate }),
        data: agentCases,
        expect: (ctx) => {
          namespace.assert(ctx as never)
        },
      })
      const experiment = await run(evaluation)
      const cell = experiment.cells[0]!
      expect(cell.status).toBe('failed')
      const failures = cell.assertions.outcomes.filter((outcome) => outcome.status === 'failed' || outcome.status === 'uncaptured')
      expect(failures).toHaveLength(1)
      const failure = failures[0]!
      expect(failure.matcher).toBe(`${namespace.name} (uncaptured)`)
      expect(failure.message).toContain(`no ${namespace.name} signal was captured`)
      expect(failure.message).toContain(namespace.name)
      expect(cell.assertions.outcomes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: 'uncaptured',
            matcher: `${namespace.name} (uncaptured)`,
            soft: false,
            message: expect.stringContaining(`no ${namespace.name} signal was captured`),
          }),
        ]),
      )
    })
  }
})

describe('task execution — prompt, flow, retriever, agent', () => {
  it('executes a prompt task via the resolved generate fn (params > setup)', async () => {
    const seen: Array<Record<string, unknown>> = []
    const generate = (async (_prompt: never, opts: never) => {
      seen.push(opts as Record<string, unknown>)
      return { object: { answer: 'from params' } }
    }) as GenerateFn

    const evaluation = evaluate({
      task: supportPrompt,
      data: [{ input: { question: 'q1' } }],
      params: { generate, model: 'fast-model', settings: { temperature: 0 } },
    })
    const experiment = await run(evaluation)
    expect(experiment.cells[0]!.output).toEqual({ answer: 'from params' })
    expect(seen[0]).toMatchObject({ input: { question: 'q1' }, model: 'fast-model', temperature: 0 })
  })

  it('resolves generate and named models from setup when params omit them', async () => {
    const seen: Array<Record<string, unknown>> = []
    const generate = (async (_prompt: never, opts: never) => {
      seen.push(opts as Record<string, unknown>)
      return { text: 'a haiku' }
    }) as GenerateFn

    const evaluation = evaluate({
      task: textPrompt,
      data: [{ input: { topic: 'rivers' } }],
      params: { model: 'cheap' },
    })
    const experiment = await run(evaluation, undefined, {
      setup: { generate, models: { cheap: { id: 'resolved-cheap-model' } } },
    })
    // Text-mode prompt: output is result.text.
    expect(experiment.cells[0]!.output).toBe('a haiku')
    // Named model string resolved through setup.models.
    expect(seen[0]!.model).toEqual({ id: 'resolved-cheap-model' })
  })

  it('target.prompt defaults feed the params floor', async () => {
    const seen: Array<Record<string, unknown>> = []
    const generate = (async (_prompt: never, opts: never) => {
      seen.push(opts as Record<string, unknown>)
      return { object: { answer: 'ok' } }
    }) as GenerateFn

    const evaluation = evaluate({
      task: target.prompt(supportPrompt, { generate, model: 'default-model' }),
      data: [{ input: { question: 'q' } }],
      params: { model: 'override-model' },
    })
    await run(evaluation)
    expect(seen[0]!.model).toBe('override-model')
  })

  it('executes a flow task end-to-end with trace-backed step signals', async () => {
    const researchFlow = flow('research', async (scope, input: { topic: string }) => {
      const plan = await scope.step('plan', () => ({ angle: `${input.topic} basics` }))
      const draft = await scope.step('draft', () => ({ summary: `About ${plan.angle}` }))
      return draft
    })

    const evaluation = evaluate({
      task: researchFlow,
      data: [{ input: { topic: 'tides' } }],
      expect: (ctx) => {
        ctx.expect(ctx.output.summary).toContain('tides')
        ctx.expect.steps.toHaveOrder('plan', 'draft')
        ctx.expect.steps.toHaveSucceeded('draft')
        const plan = ctx.step('plan', z.object({ angle: z.string() }))
        ctx.expect(plan.output.angle).toBe('tides basics')
      },
    })
    const experiment = await run(evaluation)
    expect(experiment.cells[0]!.status).toBe('passed')
    expect(experiment.cells[0]!.capturedSignals).toContain('steps')
  })

  it('ctx.step throws a helpful error for unknown steps and schema mismatches', async () => {
    const tinyFlow = flow('tiny', async (scope, _input: { q: string }) => {
      await scope.step('only-step', () => ({ value: 42 }))
      return { ok: true }
    })
    const evaluation = evaluate({
      task: tinyFlow,
      data: [{ input: { q: 'x' } }],
      expect: (ctx) => {
        ctx
          .expect(() => ctx.step('missing'))
          .toSatisfy((fn) => {
            try {
              ;(fn as () => unknown)()
              return false
            } catch (error) {
              return error instanceof Error && error.message.includes('no step with this name')
            }
          })
        ctx
          .expect(() => ctx.step('only-step', z.object({ value: z.string() })))
          .toSatisfy((fn) => {
            try {
              ;(fn as () => unknown)()
              return false
            } catch (error) {
              return error instanceof Error && error.message.includes('failed schema validation')
            }
          })
      },
    })
    const experiment = await run(evaluation)
    expect(experiment.cells[0]!.status).toBe('passed')
  })

  it('executes a retriever task via the query mapper and records output hits', async () => {
    const stubRetriever = {
      _tag: 'Retriever' as const,
      id: 'docs',
      retrieve: async (query: string) => [
        { sourceId: 'docs/refunds', chunkId: 'c1', score: 0.9, text: `about ${query}` },
      ],
    }
    const evaluation = evaluate({
      task: target.retriever(stubRetriever as never, {
        query: (input: { question: string }) => input.question,
      }),
      data: [{ input: { question: 'refunds' } }],
    })
    const experiment = await run(evaluation)
    const output = experiment.cells[0]!.output as Array<{ sourceId: string }>
    expect(output[0]!.sourceId).toBe('docs/refunds')
  })

  it('agent tasks resolve tool mocks into executable tools for the adapter', async () => {
    const toolAgent = agent({
      id: 'tool-agent',
      prompt: supportPrompt,
      tools: { lookupOrder: { description: 'look up an order' } } as never,
    })
    let receivedTools: Record<string, { execute?: (args: unknown) => unknown }> | undefined
    const generate = (async (_prompt: never, opts: never) => {
      receivedTools = (opts as { tools?: typeof receivedTools }).tools
      return { object: { answer: 'done' } }
    }) as GenerateFn

    const evaluation = evaluate({
      task: target.agent(toolAgent, { generate, tools: { lookupOrder: { status: 'shipped' } }, maxToolSteps: 8 }),
      data: agentCases,
    })
    await run(evaluation)
    expect(receivedTools).toBeDefined()
    expect(receivedTools!.lookupOrder!.execute!({})).toEqual({ status: 'shipped' })
  })
})

describe('persistence, redaction, truncation', () => {
  it('persists the record with redacted snapshots and the cases key', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-'))
    const evaluation = evaluate('persist.smoke', {
      task: async (input: { q: string; apiKey: string; email: string }) => ({
        echoed: input.q,
        apiKey: 'sk-leaked',
      }),
      data: [{ input: { q: 'hello', apiKey: 'sk-secret', email: 'user@example.com' } }],
    })
    const experiment = await run(evaluation, undefined, {
      persist: true,
      dir,
      redact: ['email'],
    })

    const files = await readdir(join(dir, 'experiments'))
    expect(files).toEqual([`${experiment.experimentId}.json`])
    const record = JSON.parse(await readFile(join(dir, 'experiments', files[0]!), 'utf8')) as Record<string, unknown>
    expect(record.schemaVersion).toBe(2)
    expect(record.evaluationId).toBe('persist.smoke')
    expect(record.cells).toHaveLength(1)
    expect(record.cases).toBeUndefined()
    expect(record.promote).toBeUndefined()
    const cell = (record.cells as Array<Record<string, unknown>>)[0]!
    // Always-on redaction (apiKey) + configured dot-path (email), input AND output.
    expect(cell.input).toEqual({ q: 'hello', apiKey: '[redacted]', email: '[redacted]' })
    expect(cell.output).toEqual({ echoed: 'hello', apiKey: '[redacted]' })
  })

  it('truncates oversized outputs at 32 KiB and flags metadata.truncated', async () => {
    const evaluation = evaluate({
      task: async (_input: { q: string }) => 'y'.repeat(64 * 1024),
      data: [{ input: { q: 'big' } }],
    })
    const experiment = await run(evaluation)
    const cell = experiment.cells[0]!
    expect((cell.output as string).endsWith('…[truncated]')).toBe(true)
    expect((cell.output as string).length).toBeLessThan(64 * 1024)
    expect(cell.metadata).toEqual({ truncated: true })
    expect(cell.status).toBe('passed')
  })

  it('evaluation.run() persists under cwd/.crux/quality by default', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-run-'))
    const previousCwd = process.cwd()
    process.chdir(dir)
    try {
      const evaluation = evaluate('public.run', {
        task: async (input: { q: string }) => input.q,
        data: [{ input: { q: 'x' } }],
      })
      const experiment = await evaluation.run()
      expect(experiment.passed).toBe(true)
      const files = await readdir(join(dir, '.crux/quality/experiments'))
      expect(files).toEqual([`${experiment.experimentId}.json`])
    } finally {
      process.chdir(previousCwd)
    }
  })
})

describe('datasets', () => {
  it('loads, validates, and concatenates JSONL dataset rows with inline cases', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-ds-'))
    const { writeFile } = await import('node:fs/promises')
    await writeFile(
      join(dir, 'golden.jsonl'),
      [
        JSON.stringify({ input: { q: 'row1' }, expected: { answer: 'ROW1' } }),
        JSON.stringify({ name: 'row two', input: { q: 'row2' } }),
      ].join('\n'),
      'utf8',
    )
    const { dataset } = await import('../../quality')
    const golden = dataset('golden.jsonl', {
      input: z.object({ q: z.string() }),
      expected: z.object({ answer: z.string() }),
    })
    const evaluation = evaluate({
      task: async (input: { q: string }) => ({ answer: input.q.toUpperCase() }),
      data: [[{ input: { q: 'inline' } }], golden].flat() as never,
    })
    const experiment = await run(evaluation, undefined, { rootDir: dir })
    expect(experiment.cells).toHaveLength(3)
    const datasetCell = experiment.cells.find((cell) => cell.caseName === 'row two')
    expect(datasetCell).toBeDefined()
    expect(datasetCell!.status).toBe('passed')
  })

  it('rejects rows that fail the dataset schema as a definition error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-ds-'))
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, 'bad.jsonl'), JSON.stringify({ input: { q: 42 } }), 'utf8')
    const { dataset } = await import('../../quality')
    const bad = dataset('bad.jsonl', { input: z.object({ q: z.string() }) })
    const evaluation = evaluate({
      task: async (input: { q: string }) => input.q,
      data: bad,
    })
    await expect(run(evaluation, undefined, { rootDir: dir })).rejects.toThrowError(/schema validation/)
  })
})

describe('prompt({ tests }) lowering — rung 0', () => {
  const testedPrompt = prompt({
    id: 'tested',
    input: z.object({ question: z.string() }),
    output: z.object({ answer: z.string() }),
    system: 'answer',
    tests: [
      { input: { question: 'How do refunds work?' } },
      { name: 'dutch', input: { question: 'Hoe werkt een refund?' }, expected: '14 dagen' },
    ],
  })

  it('collects only prompts with colocated tests', async () => {
    const runner = createQualityRunner({ persist: false, qualityId: 'test' })
    const collected = await runner.collect({ promptCandidates: [testedPrompt, supportPrompt] })
    expect(collected.errors).toEqual([])
    expect(collected.evaluations.map((evaluation) => evaluation.id)).toEqual(['prompt:tested'])
  })

  it('collects tests into a prompt:<id> evaluation with source prompt-tests', async () => {
    const runner = createQualityRunner({ persist: false, qualityId: 'test' })
    const collected = await runner.collect({ promptCandidates: [testedPrompt] })
    const evaluation = collected.evaluations[0]!
    expect(evaluation.id).toBe('prompt:tested')
    expect(evaluation.manifest.source).toBe('prompt-tests')
    expect(evaluation.manifest.task).toMatchObject({ kind: 'prompt', ref: 'tested' })
    expect(evaluation.manifest.cases).toHaveLength(2)
    expect(evaluation.manifest.cases[1]).toMatchObject({ caseId: 'dutch', name: 'dutch' })
    expect(evaluation.manifest.scorers).toEqual([])
    expect(evaluation.manifest.hasEvaluationExpect).toBe(true)
  })

  it('the lowered evaluation gates on output-schema validation', async () => {
    const generate = (async (_prompt: never, opts: never) => {
      const question = (opts as { input: { question: string } }).input.question
      // Valid for the first case, schema-breaking for the second.
      return question.startsWith('How') ? { object: { answer: 'within 14 days' } } : { object: { answer: 42 } }
    }) as GenerateFn

    const runner = createQualityRunner({ persist: false, qualityId: 'test', setup: { generate } })
    const collected = await runner.collect({ promptCandidates: [testedPrompt] })
    const result = await runner.run({ evaluations: collected.evaluations })
    const experiment = result.experiments[0]!
    const [first, second] = experiment.cells
    expect(first!.status).toBe('passed')
    expect(second!.status).toBe('failed')
    expect(second!.assertions.outcomes.find((outcome) => outcome.status === 'failed')?.message).toContain('output schema')
    expect(second!.expected).toBe('14 dagen')
  })

  it('reports prompts without an id as collect errors', async () => {
    const anonymous = prompt({
      input: z.object({ q: z.string() }),
      system: 's',
      tests: [{ input: { q: 'x' } }],
    })
    const runner = createQualityRunner({ persist: false, qualityId: 'test' })
    const collected = await runner.collect({ promptCandidates: [anonymous] })
    expect(collected.evaluations).toEqual([])
    expect(collected.errors[0]!.message).toMatch(/explicit `id`/)
  })
})
