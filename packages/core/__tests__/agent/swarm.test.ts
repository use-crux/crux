import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { prompt as makePrompt } from '../../src/prompt/prompt'
import { agent as makeAgent } from '../../src/agent/agent'
import { createSwarm } from '../../src/agent/swarm'
import { createFakeAgentExecutor } from '../../src/agent/fakes'
import type { FakeAgentBehavior } from '../../src/agent/fakes'
import './swarm-result-correlation.cases'

// ── Test helpers ──────────────────────────────────────────────────

/**
 * A swarm executor backed by the shared fake. Each agent's behavior is either
 * `{ output }` (return text) or `{ transfer, reason }` (the fake executes the
 * generated `transfer_to_<id>` tool, simulating the LLM handing off).
 */
function createSwarmExecutor(behavior: Record<string, FakeAgentBehavior>) {
  return createFakeAgentExecutor({ agents: behavior })
}

/** Read the `transfer_to_*` tool set the swarm passed to a given agent. */
function toolsPassedTo(
  executor: ReturnType<typeof createFakeAgentExecutor>,
  agentId: string,
): Record<string, { description?: string }> | undefined {
  return executor.calls.find((c) => c.agent.id === agentId)?.options.tools as
    | Record<string, { description?: string }>
    | undefined
}

/** Read the input the swarm passed to a given agent. */
function inputPassedTo(executor: ReturnType<typeof createFakeAgentExecutor>, agentId: string): unknown {
  return executor.calls.find((c) => c.agent.id === agentId)?.options.input
}

const triagePrompt = makePrompt({
  id: 'triage-prompt',
  system: 'You are a triage agent.',
})
const billingPrompt = makePrompt({
  id: 'billing-prompt',
  system: 'You are a billing agent.',
})
const refundsPrompt = makePrompt({
  id: 'refunds-prompt',
  system: 'You are a refunds agent.',
})

// Agents for 3-agent swarm
const triageAgent3 = makeAgent({
  id: 'triage',
  description: 'Routes support tickets',
  prompt: triagePrompt,
  handoffs: ['billing', 'refunds'],
})

const billingAgent3 = makeAgent({
  id: 'billing',
  description: 'Handles billing issues',
  prompt: billingPrompt,
  handoffs: ['triage', 'refunds'],
})

const refundsAgent3 = makeAgent({
  id: 'refunds',
  description: 'Processes refunds',
  prompt: refundsPrompt,
  handoffs: ['billing', 'triage'],
})

// Agents for 2-agent swarm (triage + billing only)
const triageAgent2 = makeAgent({
  id: 'triage',
  description: 'Routes support tickets',
  prompt: triagePrompt,
  handoffs: ['billing'],
})

const billingAgent2 = makeAgent({
  id: 'billing',
  description: 'Handles billing issues',
  prompt: billingPrompt,
  handoffs: ['triage'],
})

// ── Tests ─────────────────────────────────────────────────────────

describe('swarm', () => {
  it('completes a simple handoff chain: triage → billing → done', async () => {
    const executor = createSwarmExecutor({
      triage: { transfer: 'billing', reason: 'billing issue' },
      billing: { output: 'Your invoice has been corrected.' },
    })
    const swarm = createSwarm(executor)

    const result = await swarm({
      id: 'swarm.test-swarm-1',
      agents: { triage: triageAgent2, billing: billingAgent2 },
      startAgent: 'triage',
      input: { message: 'I was charged twice' },
      model: 'test-model',
    })

    expect(result.finalAgentId).toBe('billing')
    expect(result.output).toBe('Your invoice has been corrected.')
    expect(result.handoffPath).toEqual(['triage', 'billing'])
    expect(result.handoffCount).toBe(1)
    expect(result.agentResults).toHaveLength(2)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('returns immediately when agent completes without handoff', async () => {
    const executor = createSwarmExecutor({
      triage: { output: 'I can help you directly.' },
    })
    const swarm = createSwarm(executor)

    const result = await swarm({
      id: 'swarm.test-swarm-2',
      agents: { triage: triageAgent2, billing: billingAgent2 },
      startAgent: 'triage',
      input: { message: 'What are your hours?' },
    })

    expect(result.finalAgentId).toBe('triage')
    expect(result.output).toBe('I can help you directly.')
    expect(result.handoffPath).toEqual(['triage'])
    expect(result.handoffCount).toBe(0)
    expect(result.agentResults).toHaveLength(1)
  })

  it('supports a 3-hop chain: triage → billing → refunds → done', async () => {
    const executor = createSwarmExecutor({
      triage: { transfer: 'billing', reason: 'billing issue' },
      billing: { transfer: 'refunds', reason: 'needs refund' },
      refunds: { output: 'Refund processed successfully.' },
    })
    const swarm = createSwarm(executor)

    const result = await swarm({
      id: 'swarm.test-swarm-3',
      agents: {
        triage: triageAgent3,
        billing: billingAgent3,
        refunds: refundsAgent3,
      },
      startAgent: 'triage',
      input: { message: 'I need a refund' },
    })

    expect(result.finalAgentId).toBe('refunds')
    expect(result.handoffPath).toEqual(['triage', 'billing', 'refunds'])
    expect(result.handoffCount).toBe(2)
  })

  it('throws SwarmError when maxHandoffs is exceeded', async () => {
    // triage and billing keep handing off to each other
    const executor = createSwarmExecutor({
      triage: { transfer: 'billing', reason: 'billing issue' },
      billing: { transfer: 'triage', reason: 'needs triage' },
    })
    const swarm = createSwarm(executor)

    await expect(
      swarm({
        id: 'swarm.test-swarm-4',
        agents: { triage: triageAgent2, billing: billingAgent2 },
        startAgent: 'triage',
        input: { message: 'loop' },
        maxHandoffs: 3,
      }),
    ).rejects.toThrow(/maxHandoffs.*3/)
  })

  it('throws when startAgent does not exist', async () => {
    const executor = createSwarmExecutor({})
    const swarm = createSwarm(executor)

    await expect(
      swarm({
        id: 'swarm.test-swarm-5',
        agents: { triage: triageAgent2 },
        startAgent: 'nonexistent',
        input: {},
      }),
    ).rejects.toThrow(/nonexistent/)
  })

  it('throws when a handoff target does not exist in the agents map', async () => {
    const agentWithBadHandoff = makeAgent({
      id: 'bad',
      prompt: triagePrompt,
      handoffs: ['missing-agent'],
    })
    const executor = createSwarmExecutor({})
    const swarm = createSwarm(executor)

    await expect(
      swarm({
        id: 'swarm.test-swarm-6',
        agents: { bad: agentWithBadHandoff },
        startAgent: 'bad',
        input: {},
      }),
    ).rejects.toThrow(/missing-agent/)
  })

  it('generates transfer_to_<id> tools with target description', async () => {
    const executor = createSwarmExecutor({ triage: { output: 'done' } })
    const swarm = createSwarm(executor)

    await swarm({
      id: 'swarm.test-swarm-7',
      agents: {
        triage: triageAgent3,
        billing: billingAgent3,
        refunds: refundsAgent3,
      },
      startAgent: 'triage',
      input: {},
    })

    const capturedTools = toolsPassedTo(executor, 'triage')
    expect(capturedTools).toBeDefined()
    expect(capturedTools!['transfer_to_billing']).toBeDefined()
    expect(capturedTools!['transfer_to_refunds']).toBeDefined()
    expect(capturedTools!['transfer_to_billing']?.description).toContain('billing')
    // Should NOT have a transfer tool to self
    expect(capturedTools!['transfer_to_triage']).toBeUndefined()
  })

  describe('conditional handoffs', () => {
    it('injects when condition into transfer tool description', async () => {
      const conditionalAgent = makeAgent({
        id: 'triage',
        prompt: triagePrompt,
        handoffs: ['general', { id: 'billing', when: 'Customer has a billing or payment issue' }],
      })
      const generalAgent = makeAgent({
        id: 'general',
        prompt: triagePrompt,
        handoffs: [],
      })

      const executor = createSwarmExecutor({ triage: { output: 'done' } })
      const swarm = createSwarm(executor)

      await swarm({
        id: 'swarm.test-swarm-8',
        agents: {
          triage: conditionalAgent,
          billing: billingAgent2,
          general: generalAgent,
        },
        startAgent: 'triage',
        input: {},
      })

      const capturedTools = toolsPassedTo(executor, 'triage')
      // Conditional handoff should have 'when' in description
      expect(capturedTools!['transfer_to_billing']?.description).toContain('billing or payment issue')
      // String handoff should still work normally
      expect(capturedTools!['transfer_to_general']).toBeDefined()
    })

    it('works with mixed array of strings and conditional objects', async () => {
      const mixedAgent = makeAgent({
        id: 'router',
        prompt: triagePrompt,
        handoffs: [
          'fast-track',
          {
            id: 'escalation',
            when: 'Customer is frustrated or requests a manager',
          },
        ],
      })
      const fastTrack = makeAgent({
        id: 'fast-track',
        prompt: triagePrompt,
        handoffs: [],
      })
      const escalation = makeAgent({
        id: 'escalation',
        prompt: triagePrompt,
        handoffs: [],
      })

      const executor = createSwarmExecutor({ router: { output: 'done' } })
      const swarm = createSwarm(executor)

      await swarm({
        id: 'swarm.test-swarm-9',
        agents: { router: mixedAgent, 'fast-track': fastTrack, escalation },
        startAgent: 'router',
        input: {},
      })

      const capturedTools = toolsPassedTo(executor, 'router')
      expect(capturedTools!['transfer_to_fast-track']).toBeDefined()
      expect(capturedTools!['transfer_to_escalation']).toBeDefined()
      expect(capturedTools!['transfer_to_escalation']?.description).toContain('frustrated')
    })

    it('validates conditional handoff targets exist in agents map', async () => {
      const badAgent = makeAgent({
        id: 'bad',
        prompt: triagePrompt,
        handoffs: [{ id: 'nonexistent', when: 'always' }],
      })
      const executor = createSwarmExecutor({})
      const swarm = createSwarm(executor)

      await expect(
        swarm({
          id: 'swarm.test-swarm-10',
          agents: { bad: badAgent },
          startAgent: 'bad',
          input: {},
        }),
      ).rejects.toThrow(/nonexistent/)
    })
  })

  it('calls onHandoff callback for each handoff', async () => {
    const onHandoff = vi.fn()
    const executor = createSwarmExecutor({
      triage: { transfer: 'billing', reason: 'billing issue' },
      billing: { output: 'Done.' },
    })
    const swarm = createSwarm(executor)

    await swarm({
      id: 'swarm.test-swarm-11',
      agents: { triage: triageAgent2, billing: billingAgent2 },
      startAgent: 'triage',
      input: {},
      onHandoff,
    })

    expect(onHandoff).toHaveBeenCalledOnce()
    expect(onHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        fromAgent: 'triage',
        toAgent: 'billing',
        reason: 'billing issue',
      }),
    )
  })

  describe('history modes', () => {
    it('transfer-only: next agent gets original input + handoff context', async () => {
      const executor = createSwarmExecutor({
        triage: { transfer: 'billing', reason: 'billing', output: 'transferring' },
        billing: { output: 'done' },
      })
      const swarm = createSwarm(executor)

      await swarm({
        id: 'swarm.test-swarm-12',
        agents: { triage: triageAgent2, billing: billingAgent2 },
        startAgent: 'triage',
        input: { message: 'original' },
        history: 'transfer-only',
      })

      const billingInput = inputPassedTo(executor, 'billing')
      expect(billingInput).toEqual(
        expect.objectContaining({
          message: 'original',
        }),
      )
      // Should also have handoff context
      expect(billingInput).toHaveProperty('_handoff')
    })

    it('accumulate: next agent gets enriched input with previous output', async () => {
      const executor = createSwarmExecutor({
        triage: { transfer: 'billing', reason: 'billing', output: 'triage analysis complete' },
        billing: { output: 'done' },
      })
      const swarm = createSwarm(executor)

      await swarm({
        id: 'swarm.test-swarm-13',
        agents: { triage: triageAgent2, billing: billingAgent2 },
        startAgent: 'triage',
        input: { message: 'original' },
        history: 'accumulate',
      })

      expect(inputPassedTo(executor, 'billing')).toEqual(
        expect.objectContaining({
          message: 'original',
          _previousOutput: 'triage analysis complete',
          _handoffPath: ['triage', 'billing'],
        }),
      )
    })

    it('custom function: receives SwarmHandoffContext and returns custom input', async () => {
      const customHistory = vi.fn().mockReturnValue({ custom: 'input', extra: 42 })
      const executor = createSwarmExecutor({
        triage: { transfer: 'billing', reason: 'billing', output: 'triage done' },
        billing: { output: 'done' },
      })
      const swarm = createSwarm(executor)

      await swarm({
        id: 'swarm.test-swarm-14',
        agents: { triage: triageAgent2, billing: billingAgent2 },
        startAgent: 'triage',
        input: { message: 'original' },
        history: customHistory,
      })

      expect(customHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          originalInput: { message: 'original' },
          previousOutput: 'triage done',
          fromAgent: 'triage',
          toAgent: 'billing',
          reason: 'billing',
        }),
      )
      expect(inputPassedTo(executor, 'billing')).toEqual({ custom: 'input', extra: 42 })
    })
  })

  describe('context summarization', () => {
    it('summarizes previous output after threshold in accumulate mode', async () => {
      const generateFn = vi.fn().mockResolvedValue({ text: 'Summarized: customer needs refund' })

      // 3-hop chain: triage → billing → refunds
      const executor = createSwarmExecutor({
        triage: { transfer: 'billing', reason: 'billing', output: 'triage analysis' },
        billing: {
          transfer: 'refunds',
          reason: 'refund',
          output: 'billing checked invoice #1234 and found duplicate charge',
        },
        refunds: { output: 'done' },
      })
      const swarm = createSwarm(executor)

      await swarm({
        id: 'swarm.test-swarm-15',
        agents: {
          triage: triageAgent3,
          billing: billingAgent3,
          refunds: refundsAgent3,
        },
        startAgent: 'triage',
        input: { message: 'help' },
        history: 'accumulate',
        summarize: {
          generate: generateFn,
          model: 'cheap-model',
          after: 2, // summarize from 2nd handoff onwards
        },
      })

      // generateFn should have been called for the 2nd handoff (billing → refunds)
      expect(generateFn).toHaveBeenCalledOnce()
      expect(generateFn).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'cheap-model',
        }),
      )

      // refunds agent should receive summarized output, not raw
      const refundsInput = inputPassedTo(executor, 'refunds') as { _previousOutput: string }
      expect(refundsInput._previousOutput).toBe('Summarized: customer needs refund')
    })

    it('does not summarize before threshold', async () => {
      const generateFn = vi.fn().mockResolvedValue({ text: 'summary' })

      const executor = createSwarmExecutor({
        triage: { transfer: 'billing', reason: 'billing', output: 'raw triage output' },
        billing: { output: 'done' },
      })
      const swarm = createSwarm(executor)

      await swarm({
        id: 'swarm.test-swarm-16',
        agents: { triage: triageAgent2, billing: billingAgent2 },
        startAgent: 'triage',
        input: { message: 'help' },
        history: 'accumulate',
        summarize: {
          generate: generateFn,
          model: 'cheap-model',
          after: 3, // only after 3rd handoff
        },
      })

      // Should NOT have called generateFn (only 1 handoff, threshold is 3)
      expect(generateFn).not.toHaveBeenCalled()
      // Billing should get raw output
      const billingInput = inputPassedTo(executor, 'billing') as { _previousOutput: string }
      expect(billingInput._previousOutput).toBe('raw triage output')
    })

    it('ignores summarize option in transfer-only mode', async () => {
      const generateFn = vi.fn().mockResolvedValue({ text: 'summary' })

      const executor = createSwarmExecutor({
        triage: { transfer: 'billing', reason: 'billing', output: 'output' },
        billing: { output: 'done' },
      })
      const swarm = createSwarm(executor)

      await swarm({
        id: 'swarm.test-swarm-17',
        agents: { triage: triageAgent2, billing: billingAgent2 },
        startAgent: 'triage',
        input: { message: 'help' },
        history: 'transfer-only',
        summarize: {
          generate: generateFn,
          model: 'cheap-model',
          after: 1,
        },
      })

      expect(generateFn).not.toHaveBeenCalled()
    })
  })

  describe('tool filtering', () => {
    it('agent with swarmTools only gets those tools plus transfer tools', async () => {
      const agent = makeAgent({
        id: 'filtered',
        prompt: triagePrompt,
        tools: {
          search: { description: 'Search', execute: async () => 'found' },
          deleteAll: {
            description: 'Dangerous',
            execute: async () => 'deleted',
          },
          lookup: { description: 'Lookup', execute: async () => 'looked' },
        } as any,
        swarmTools: ['search', 'lookup'],
        handoffs: ['helper'],
      })
      const helper = makeAgent({
        id: 'helper',
        prompt: triagePrompt,
        handoffs: [],
      })

      const executor = createSwarmExecutor({ filtered: { output: 'done' } })
      const swarm = createSwarm(executor)

      await swarm({
        id: 'swarm.test-swarm-18',
        agents: { filtered: agent, helper },
        startAgent: 'filtered',
        input: {},
      })

      const capturedTools = toolsPassedTo(executor, 'filtered')
      // Should have filtered tools + transfer tool
      expect(capturedTools!['search']).toBeDefined()
      expect(capturedTools!['lookup']).toBeDefined()
      expect(capturedTools!['transfer_to_helper']).toBeDefined()
      // Should NOT have the excluded tool
      expect(capturedTools!['deleteAll']).toBeUndefined()
    })

    it('swarm-level activeTools overrides agent-level swarmTools', async () => {
      const agent = makeAgent({
        id: 'agent',
        prompt: triagePrompt,
        tools: {
          search: { description: 'Search', execute: async () => 'found' },
          lookup: { description: 'Lookup', execute: async () => 'looked' },
          admin: { description: 'Admin', execute: async () => 'admin' },
        } as any,
        swarmTools: ['search', 'lookup'], // agent says search + lookup
        handoffs: ['helper'],
      })
      const helper = makeAgent({
        id: 'helper',
        prompt: triagePrompt,
        handoffs: [],
      })

      const executor = createSwarmExecutor({ agent: { output: 'done' } })
      const swarm = createSwarm(executor)

      await swarm({
        id: 'swarm.test-swarm-19',
        agents: { agent, helper },
        startAgent: 'agent',
        input: {},
        activeTools: { agent: ['search'] }, // swarm overrides to just search
      })

      const capturedTools = toolsPassedTo(executor, 'agent')
      expect(capturedTools!['search']).toBeDefined()
      expect(capturedTools!['transfer_to_helper']).toBeDefined()
      // Excluded by swarm-level override
      expect(capturedTools!['lookup']).toBeUndefined()
      expect(capturedTools!['admin']).toBeUndefined()
    })

    it('agent without swarmTools gets all tools (backward compatible)', async () => {
      const agent = makeAgent({
        id: 'unfiltered',
        prompt: triagePrompt,
        tools: {
          search: { description: 'Search', execute: async () => 'found' },
          admin: { description: 'Admin', execute: async () => 'admin' },
        } as any,
        handoffs: ['helper'],
      })
      const helper = makeAgent({
        id: 'helper',
        prompt: triagePrompt,
        handoffs: [],
      })

      const executor = createSwarmExecutor({ unfiltered: { output: 'done' } })
      const swarm = createSwarm(executor)

      await swarm({
        id: 'swarm.test-swarm-20',
        agents: { unfiltered: agent, helper },
        startAgent: 'unfiltered',
        input: {},
      })

      const capturedTools = toolsPassedTo(executor, 'unfiltered')
      expect(capturedTools!['search']).toBeDefined()
      expect(capturedTools!['admin']).toBeDefined()
      expect(capturedTools!['transfer_to_helper']).toBeDefined()
    })
  })

  describe('cost tracking and abort', () => {
    it('calls onCost with accumulated usage after each agent', async () => {
      const onCost = vi.fn()
      const executor = createSwarmExecutor({
        triage: {
          transfer: 'billing',
          reason: 'billing',
          output: 'transferring',
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, inputTokenDetails: {}, outputTokenDetails: {} },
        },
        billing: {
          output: 'done',
          usage: { inputTokens: 200, outputTokens: 100, totalTokens: 300, inputTokenDetails: {}, outputTokenDetails: {} },
        },
      })
      const swarm = createSwarm(executor)

      await swarm({
        id: 'swarm.test-swarm-21',
        agents: { triage: triageAgent2, billing: billingAgent2 },
        startAgent: 'triage',
        input: {},
        onCost,
      })

      expect(onCost).toHaveBeenCalledTimes(2)
      // First call: after triage
      expect(onCost.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          totalTokens: 150,
          inputTokens: 100,
          outputTokens: 50,
        }),
      )
      // Second call: after billing (accumulated)
      expect(onCost.mock.calls[1][0]).toEqual(
        expect.objectContaining({
          totalTokens: 450,
          inputTokens: 300,
          outputTokens: 150,
        }),
      )
    })

    it('abort() stops the swarm and returns last result', async () => {
      const executor = createSwarmExecutor({
        triage: {
          transfer: 'billing',
          reason: 'billing',
          output: 'transferring',
          usage: {
            inputTokens: 40,
            outputTokens: 60,
            totalTokens: 100,
            inputTokenDetails: {},
            outputTokenDetails: {},
          },
        },
        billing: { output: 'done' },
      })
      const swarm = createSwarm(executor)

      const result = await swarm({
        id: 'swarm.test-swarm-22',
        agents: { triage: triageAgent2, billing: billingAgent2 },
        startAgent: 'triage',
        input: {},
        onCost: ({ abort }) => {
          abort() // abort immediately after first agent
        },
      })

      // Should have stopped after triage — billing never ran
      expect(result.agentResults).toHaveLength(1)
      expect(result.finalAgentId).toBe('triage')
      expect(result.output).toBe('transferring')
    })

    it('dryRun returns estimates without executing agents', async () => {
      const executor = createFakeAgentExecutor()
      const swarm = createSwarm(executor)

      const result = await swarm({
        id: 'swarm.test-swarm-23',
        agents: { triage: triageAgent2, billing: billingAgent2 },
        startAgent: 'triage',
        input: {},
        dryRun: true,
        maxHandoffs: 5,
      })

      expect(executor.calls).toHaveLength(0)
      expect(result.agentCount).toBe(2)
      expect(result.maxPossibleHops).toBe(5)
    })
  })

  it('propagates agent execution errors', async () => {
    const executor = createSwarmExecutor({ triage: { throws: 'Agent crashed' } })
    const swarm = createSwarm(executor)

    await expect(
      swarm({
        id: 'swarm.test-swarm-24',
        agents: { triage: triageAgent2, billing: billingAgent2 },
        startAgent: 'triage',
        input: {},
      }),
    ).rejects.toThrow('Agent crashed')
  })

})
