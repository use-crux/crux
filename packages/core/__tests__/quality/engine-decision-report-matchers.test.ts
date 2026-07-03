import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { agent } from '../../agent/agent'
import { observe } from '../../observability'
import type { TurnDecisionReport } from '../../observability/turn-decision-report'
import { prompt } from '../../prompt/prompt'
import { evaluate, target } from '../../quality'
import type { GenerateFn } from '../../quality/target'
import { runEvaluationWithRunner as run } from './runner-harness'

const supportPrompt = prompt({
  id: 'support',
  input: z.object({ question: z.string() }),
  output: z.object({ answer: z.string() }),
  system: 'Answer support questions.',
})

const supportAgent = agent({ id: 'support-agent', prompt: supportPrompt })

function decisionReport(): TurnDecisionReport {
  return {
    schemaVersion: 1,
    reportId: 'tdr:run:turn',
    runId: 'run',
    turn: { id: 'turn', kind: 'generation.call', verdict: 'Answered with 1 active context.' },
    saw: [
      {
        kind: 'context',
        id: 'context:customerProfile',
        name: 'customerProfile',
        disposition: 'active',
        evidenceLevel: 'declared',
        sourceStatus: 'used',
      },
    ],
    considered: [],
    freshness: [
      {
        subject: { kind: 'context', id: 'context:customerProfile', name: 'customerProfile' },
        status: 'stale-rejected',
        evidenceLevel: 'declared',
      },
    ],
    cache: [
      {
        subject: { kind: 'context', id: 'context:customerProfile', name: 'customerProfile' },
        status: 'hit',
        rejectedByFreshness: true,
        evidenceLevel: 'declared',
      },
    ],
    decisions: [
      {
        id: 'decision:turn:context:customerProfile',
        phase: 'request',
        kind: 'context.disposition',
        subject: { kind: 'context', id: 'context:customerProfile', name: 'customerProfile' },
        outcome: 'active',
        reason: {
          code: 'context.active',
          text: 'Context was active.',
          evidenceLevel: 'declared',
          source: 'artifact',
        },
      },
      {
        id: 'decision:turn:routing:billing',
        phase: 'model-selection',
        kind: 'routing.router',
        subject: { kind: 'route', id: 'route:billing', name: 'billing' },
        outcome: 'selected',
        reason: {
          code: 'routing.router.selected',
          text: 'Route selected.',
          evidenceLevel: 'observed',
          source: 'span-attribute',
        },
      },
      {
        id: 'decision:turn:fallback:primary',
        phase: 'recovery',
        kind: 'routing.fallback',
        subject: { kind: 'model', id: 'openai/gpt-5-mini', name: 'openai/gpt-5-mini' },
        outcome: 'fired',
        reason: {
          code: 'routing.fallback.fired',
          text: 'Fallback fired.',
          evidenceLevel: 'observed',
          source: 'span-attribute',
        },
      },
      {
        id: 'decision:turn:cache:customerProfile',
        phase: 'efficiency',
        kind: 'context.cache',
        subject: { kind: 'context', id: 'context:customerProfile', name: 'customerProfile' },
        outcome: 'hit',
        reason: {
          code: 'cache.freshness.rejected',
          text: 'Cache hit rejected by freshness.',
          evidenceLevel: 'declared',
          source: 'artifact',
        },
        cache: {
          subject: { kind: 'context', id: 'context:customerProfile', name: 'customerProfile' },
          status: 'hit',
          rejectedByFreshness: true,
          evidenceLevel: 'declared',
        },
      },
    ],
    source: [],
    coverage: { covered: 0, total: 6, areas: [] },
    gaps: [],
  }
}

const generateWithDecisionReport = (async (_prompt: never, _opts: never) => {
  await observe.span({ name: 'generate support', primitive: 'generation.call' }, async () => {
    observe.artifact({
      kind: 'custom.turn_decision_report',
      contentType: 'application/json',
      encoding: 'json',
      preview: decisionReport(),
    })
  })
  return { object: { answer: 'refunds resolve within 14 days' } }
}) as GenerateFn

describe('Quality runner — TurnDecisionReport matchers', () => {
  it('asserts context dispositions by stable reason code', async () => {
    const evaluation = evaluate({
      task: target.agent(supportAgent, { generate: generateWithDecisionReport }),
      data: [{ input: { question: 'How do refunds work?' } }],
      expect: (ctx) => {
        ctx.expect.decisionReport.context.toHaveDisposition('context:customerProfile', 'active', {
          reasonCode: 'context.active',
        })
      },
    })

    const experiment = await run(evaluation)
    const cell = experiment.perCase[0]!
    expect(cell.status).toBe('passed')
    expect(cell.assertions.failures).toEqual([])
    expect(cell.capturedSignals).toContain('decisionReports')
  })

  it('asserts routing and fallback outcomes by stable reason code', async () => {
    const evaluation = evaluate({
      task: target.agent(supportAgent, { generate: generateWithDecisionReport }),
      data: [{ input: { question: 'How do refunds work?' } }],
      expect: (ctx) => {
        ctx.expect.decisionReport.routing.toHaveOutcome('route:billing', 'selected', {
          reasonCode: 'routing.router.selected',
        })
        ctx.expect.decisionReport.fallback.toHaveFired({
          reasonCode: 'routing.fallback.fired',
        })
      },
    })

    const experiment = await run(evaluation)
    const cell = experiment.perCase[0]!
    expect(cell.status).toBe('passed')
    expect(cell.assertions.failures).toEqual([])
  })

  it('asserts freshness and cache acceptance separately by stable reason code', async () => {
    const evaluation = evaluate({
      task: target.agent(supportAgent, { generate: generateWithDecisionReport }),
      data: [{ input: { question: 'How do refunds work?' } }],
      expect: (ctx) => {
        ctx.expect.decisionReport.freshness.toHaveStatus('context:customerProfile', 'stale-rejected')
        ctx.expect.decisionReport.cache.toHaveFreshnessAcceptance('context:customerProfile', 'rejected', {
          reasonCode: 'cache.freshness.rejected',
        })
      },
    })

    const experiment = await run(evaluation)
    const cell = experiment.perCase[0]!
    expect(cell.status).toBe('passed')
    expect(cell.assertions.failures).toEqual([])
  })
})
