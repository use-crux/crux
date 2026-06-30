/**
 * Type checks for Quality's TurnDecisionReport matcher namespace.
 *
 * The namespace is exposed for model-backed tasks and stays hidden for task
 * kinds that cannot capture turn-level model decisions.
 */

import { z } from 'zod'
import { agent } from '../agent/agent'
import { flow } from '../flow/scope'
import { prompt } from '../prompt/prompt'
import type { Retriever } from '../retrieval'
import { evaluate } from '../quality'

const supportPrompt = prompt({
  id: 'support',
  input: z.object({ question: z.string() }),
  output: z.object({ answer: z.string() }),
  system: 'Answer support questions.',
})

const supportFlow = flow<{ answer: string }, { question: string }>('support-flow', async () => ({ answer: '' }))
const supportAgent = agent({ id: 'support-agent', prompt: supportPrompt })
declare const docsRetriever: Retriever

evaluate({
  task: supportPrompt,
  data: [{ input: { question: 'q' } }],
  expect: (ctx) => {
    ctx.expect.decisionReport.context.toHaveDisposition('context:customerProfile', 'active', {
      reasonCode: 'context.active',
    })
    ctx.expect.decisionReport.routing.toHaveOutcome('route:billing', 'selected', {
      reasonCode: 'routing.router.selected',
    })
    ctx.expect.decisionReport.fallback.toHaveFired({ reasonCode: 'routing.fallback.fired' })
    ctx.expect.decisionReport.freshness.toHaveStatus('context:customerProfile', 'stale-rejected')
    ctx.expect.decisionReport.cache.toHaveFreshnessAcceptance('context:customerProfile', 'rejected', {
      reasonCode: 'cache.freshness.rejected',
    })
    ctx.expect.decisionReport.context.toHaveDisposition('context:custom', 'checked', {
      reasonCode: 'custom.context_policy',
    })
    // @ts-expect-error - reason codes must use the stable TurnDecisionReport code families.
    ctx.expect.decisionReport.context.toHaveDisposition('context:customerProfile', 'active', { reasonCode: 'active' })
  },
})

evaluate({
  task: supportFlow,
  data: [{ input: { question: 'q' } }],
  expect: (ctx) => {
    ctx.expect.decisionReport.context.toHaveDisposition('context:customerProfile', 'disabled')
  },
})

evaluate({
  task: supportAgent,
  data: [{ input: { question: 'q' } }],
  expect: (ctx) => {
    ctx.expect.decisionReport.cache.toHaveFreshnessAcceptance('context:customerProfile', 'accepted')
  },
})

evaluate({
  task: docsRetriever,
  data: [{ input: { query: 'refunds' } }],
  expect: (ctx) => {
    // @ts-expect-error - retrievers capture retrieval signals, not generation turn reports.
    ctx.expect.decisionReport
  },
})

evaluate({
  task: async (input: { question: string }) => ({ answer: input.question }),
  data: [{ input: { question: 'q' } }],
  expect: (ctx) => {
    // @ts-expect-error - plain functions do not capture TurnDecisionReport signals.
    ctx.expect.decisionReport
  },
})
