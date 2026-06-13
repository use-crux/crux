import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { prompt as makePrompt } from '../../define'
import { agent as makeAgent } from '../../agent/agent'
import { createConsensus } from '../../agent/consensus'
import { createFakeAgentExecutor } from '../../agent/fakes'

const classifyPrompt = makePrompt({
  id: 'classify',
  input: z.object({ text: z.string() }),
  output: z.object({ category: z.string() }),
  system: 'Classify the input.',
})

const classifier = makeAgent({ id: 'classifier', prompt: classifyPrompt })

/**
 * An executor where voters return pre-set categories in call order. Voters all
 * share the `classifier` id, so the shared fake's call-index resolver supplies
 * the next vote per invocation.
 */
function createVotingExecutor(votes: string[]) {
  return createFakeAgentExecutor({
    fallback: (_agent, _options, callIndex) => ({ output: { category: votes[callIndex] } }),
  })
}

describe('consensus', () => {
  it('unanimous agreement returns 1.0 agreement', async () => {
    const executor = createVotingExecutor(['billing', 'billing', 'billing'])
    const consensus = createConsensus(executor)

    const result = await consensus({
      agents: [classifier, classifier, classifier],
      input: { text: 'refund request' },
      extract: (r) => r.output.category,
    })

    expect(result.result).toBe('billing')
    expect(result.agreement).toBe(1)
    expect(result.votes).toEqual({ billing: 3 })
    expect(result.details).toHaveLength(3)
  })

  it('majority wins with 2/3 agreement', async () => {
    const executor = createVotingExecutor(['billing', 'billing', 'shipping'])
    const consensus = createConsensus(executor)

    const result = await consensus({
      agents: [classifier, classifier, classifier],
      input: { text: 'test' },
      extract: (r) => r.output.category,
    })

    expect(result.result).toBe('billing')
    expect(result.agreement).toBeCloseTo(2 / 3)
    expect(result.votes).toEqual({ billing: 2, shipping: 1 })
  })

  it('all different picks most frequent (first for ties)', async () => {
    const executor = createVotingExecutor(['billing', 'shipping', 'general'])
    const consensus = createConsensus(executor)

    const result = await consensus({
      agents: [classifier, classifier, classifier],
      input: { text: 'test' },
      extract: (r) => r.output.category,
      quorum: 1, // no quorum requirement — just test tie-breaking
    })

    // All tied at 1 — first encountered wins
    expect(result.agreement).toBeCloseTo(1 / 3)
    expect(result.votes).toEqual({ billing: 1, shipping: 1, general: 1 })
  })

  it('quorum: unanimous throws on disagreement', async () => {
    const executor = createVotingExecutor(['billing', 'billing', 'shipping'])
    const consensus = createConsensus(executor)

    await expect(
      consensus({
        agents: [classifier, classifier, classifier],
        input: { text: 'test' },
        extract: (r) => r.output.category,
        quorum: 'unanimous',
      }),
    ).rejects.toThrow(/quorum|consensus/i)
  })

  it('quorum: number succeeds when threshold met', async () => {
    const executor = createVotingExecutor(['billing', 'billing', 'shipping'])
    const consensus = createConsensus(executor)

    const result = await consensus({
      agents: [classifier, classifier, classifier],
      input: { text: 'test' },
      extract: (r) => r.output.category,
      quorum: 2,
    })

    expect(result.result).toBe('billing')
  })

  it('quorum: number throws when threshold not met', async () => {
    const executor = createVotingExecutor(['billing', 'shipping', 'general'])
    const consensus = createConsensus(executor)

    await expect(
      consensus({
        agents: [classifier, classifier, classifier],
        input: { text: 'test' },
        extract: (r) => r.output.category,
        quorum: 2,
      }),
    ).rejects.toThrow(/quorum|consensus/i)
  })

  it('inherits parallel error handling (fail-fast)', async () => {
    const executor = createFakeAgentExecutor({ agents: { classifier: { throws: 'classifier down' } } })
    const consensus = createConsensus(executor)

    await expect(
      consensus({
        agents: [classifier, classifier],
        input: { text: 'test' },
        extract: (r) => r.output.category,
      }),
    ).rejects.toThrow('classifier down')
  })

  it('returns durationMs', async () => {
    const executor = createVotingExecutor(['billing', 'billing'])
    const consensus = createConsensus(executor)

    const result = await consensus({
      agents: [classifier, classifier],
      input: { text: 'test' },
      extract: (r) => r.output.category,
    })

    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })
})
