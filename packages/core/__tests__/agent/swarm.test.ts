import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import { prompt as makePrompt } from '../../define'
import { agent as makeAgent } from '../../agent/agent'
import { createSwarm } from '../../agent/swarm'
import type { AgentExecutor, AgentResult } from '../../agent/executor'
import { setRuntime, getRuntime } from '../../runtime'

// ── Test helpers ──────────────────────────────────────────────────

/**
 * Create a mock executor that simulates tool-calling behavior.
 *
 * When the executor receives tools matching `transfer_to_*`, it can
 * simulate the LLM calling that tool by checking the `behavior` map.
 *
 * @param behavior - Map of agentId → action. Action is either:
 *   - `{ output: string }` — agent returns text without calling tools
 *   - `{ transfer: string, reason: string }` — agent calls transfer tool
 */
function createSwarmExecutor(
  behavior: Record<string, { output: string } | { transfer: string; reason: string }>,
): AgentExecutor {
  return async (agent, options) => {
    const action = behavior[agent.id]
    if (!action) throw new Error(`No behavior defined for agent "${agent.id}"`)

    if ('transfer' in action) {
      // Simulate the LLM calling the transfer tool
      const toolName = `transfer_to_${action.transfer}`
      const tools = options.tools as Record<string, { execute: (args: any) => Promise<any> }> | undefined
      const transferTool = tools?.[toolName]
      if (!transferTool) throw new Error(`Transfer tool "${toolName}" not found in options.tools`)

      // Execute the transfer tool (sets the closure flag in swarm)
      await transferTool.execute({
        reason: action.reason,
        context: `Handing off from ${agent.id}`,
      })

      return {
        agentId: agent.id,
        output: `Transferring to ${action.transfer}`,
        durationMs: 10,
      }
    }

    return {
      agentId: agent.id,
      output: action.output,
      durationMs: 10,
    }
  }
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
        agents: { bad: agentWithBadHandoff },
        startAgent: 'bad',
        input: {},
      }),
    ).rejects.toThrow(/missing-agent/)
  })

  it('generates transfer_to_<id> tools with target description', async () => {
    let capturedTools: Record<string, any> | undefined
    const executor: AgentExecutor = async (agent, options) => {
      capturedTools = options.tools as any
      return { agentId: agent.id, output: 'done', durationMs: 10 }
    }
    const swarm = createSwarm(executor)

    await swarm({
      agents: {
        triage: triageAgent3,
        billing: billingAgent3,
        refunds: refundsAgent3,
      },
      startAgent: 'triage',
      input: {},
    })

    expect(capturedTools).toBeDefined()
    expect(capturedTools!['transfer_to_billing']).toBeDefined()
    expect(capturedTools!['transfer_to_refunds']).toBeDefined()
    expect(capturedTools!['transfer_to_billing'].description).toContain('billing')
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

      let capturedTools: Record<string, any> | undefined
      const executor: AgentExecutor = async (agent, options) => {
        if (agent.id === 'triage') capturedTools = options.tools as any
        return { agentId: agent.id, output: 'done', durationMs: 10 }
      }
      const swarm = createSwarm(executor)

      await swarm({
        agents: {
          triage: conditionalAgent,
          billing: billingAgent2,
          general: generalAgent,
        },
        startAgent: 'triage',
        input: {},
      })

      // Conditional handoff should have 'when' in description
      expect(capturedTools!['transfer_to_billing'].description).toContain('billing or payment issue')
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

      let capturedTools: Record<string, any> | undefined
      const executor: AgentExecutor = async (agent, options) => {
        if (agent.id === 'router') capturedTools = options.tools as any
        return { agentId: agent.id, output: 'done', durationMs: 10 }
      }
      const swarm = createSwarm(executor)

      await swarm({
        agents: { router: mixedAgent, 'fast-track': fastTrack, escalation },
        startAgent: 'router',
        input: {},
      })

      expect(capturedTools!['transfer_to_fast-track']).toBeDefined()
      expect(capturedTools!['transfer_to_escalation']).toBeDefined()
      expect(capturedTools!['transfer_to_escalation'].description).toContain('frustrated')
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
      let billingInput: unknown
      const executor: AgentExecutor = async (agent, options) => {
        if (agent.id === 'billing') billingInput = options.input
        if (agent.id === 'triage') {
          const tools = options.tools as any
          await tools.transfer_to_billing.execute({
            reason: 'billing',
            context: 'ctx',
          })
          return { agentId: 'triage', output: 'transferring', durationMs: 10 }
        }
        return { agentId: agent.id, output: 'done', durationMs: 10 }
      }
      const swarm = createSwarm(executor)

      await swarm({
        agents: { triage: triageAgent2, billing: billingAgent2 },
        startAgent: 'triage',
        input: { message: 'original' },
        history: 'transfer-only',
      })

      expect(billingInput).toEqual(
        expect.objectContaining({
          message: 'original',
        }),
      )
      // Should also have handoff context
      expect(billingInput).toHaveProperty('_handoff')
    })

    it('accumulate: next agent gets enriched input with previous output', async () => {
      let billingInput: unknown
      const executor: AgentExecutor = async (agent, options) => {
        if (agent.id === 'billing') billingInput = options.input
        if (agent.id === 'triage') {
          const tools = options.tools as any
          await tools.transfer_to_billing.execute({
            reason: 'billing',
            context: 'ctx',
          })
          return {
            agentId: 'triage',
            output: 'triage analysis complete',
            durationMs: 10,
          }
        }
        return { agentId: agent.id, output: 'done', durationMs: 10 }
      }
      const swarm = createSwarm(executor)

      await swarm({
        agents: { triage: triageAgent2, billing: billingAgent2 },
        startAgent: 'triage',
        input: { message: 'original' },
        history: 'accumulate',
      })

      expect(billingInput).toEqual(
        expect.objectContaining({
          message: 'original',
          _previousOutput: 'triage analysis complete',
          _handoffPath: ['triage', 'billing'],
        }),
      )
    })

    it('custom function: receives SwarmHandoffContext and returns custom input', async () => {
      let billingInput: unknown
      const customHistory = vi.fn().mockReturnValue({ custom: 'input', extra: 42 })
      const executor: AgentExecutor = async (agent, options) => {
        if (agent.id === 'billing') billingInput = options.input
        if (agent.id === 'triage') {
          const tools = options.tools as any
          await tools.transfer_to_billing.execute({
            reason: 'billing',
            context: 'ctx',
          })
          return { agentId: 'triage', output: 'triage done', durationMs: 10 }
        }
        return { agentId: agent.id, output: 'done', durationMs: 10 }
      }
      const swarm = createSwarm(executor)

      await swarm({
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
      expect(billingInput).toEqual({ custom: 'input', extra: 42 })
    })
  })

  describe('context summarization', () => {
    it('summarizes previous output after threshold in accumulate mode', async () => {
      const generateFn = vi.fn().mockResolvedValue({ text: 'Summarized: customer needs refund' })
      let refundsInput: any

      // 3-hop chain: triage → billing → refunds
      const executor: AgentExecutor = async (agent, options) => {
        if (agent.id === 'refunds') refundsInput = options.input
        if (agent.id === 'triage') {
          const tools = options.tools as any
          await tools.transfer_to_billing.execute({
            reason: 'billing',
            context: 'ctx',
          })
          return {
            agentId: 'triage',
            output: 'triage analysis',
            durationMs: 10,
          }
        }
        if (agent.id === 'billing') {
          const tools = options.tools as any
          await tools.transfer_to_refunds.execute({
            reason: 'refund',
            context: 'needs refund',
          })
          return {
            agentId: 'billing',
            output: 'billing checked invoice #1234 and found duplicate charge',
            durationMs: 10,
          }
        }
        return { agentId: agent.id, output: 'done', durationMs: 10 }
      }
      const swarm = createSwarm(executor)

      await swarm({
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
      expect(refundsInput._previousOutput).toBe('Summarized: customer needs refund')
    })

    it('does not summarize before threshold', async () => {
      const generateFn = vi.fn().mockResolvedValue({ text: 'summary' })
      let billingInput: any

      const executor: AgentExecutor = async (agent, options) => {
        if (agent.id === 'billing') billingInput = options.input
        if (agent.id === 'triage') {
          const tools = options.tools as any
          await tools.transfer_to_billing.execute({
            reason: 'billing',
            context: 'ctx',
          })
          return {
            agentId: 'triage',
            output: 'raw triage output',
            durationMs: 10,
          }
        }
        return { agentId: agent.id, output: 'done', durationMs: 10 }
      }
      const swarm = createSwarm(executor)

      await swarm({
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
      expect(billingInput._previousOutput).toBe('raw triage output')
    })

    it('ignores summarize option in transfer-only mode', async () => {
      const generateFn = vi.fn().mockResolvedValue({ text: 'summary' })

      const executor: AgentExecutor = async (agent, options) => {
        if (agent.id === 'triage') {
          const tools = options.tools as any
          await tools.transfer_to_billing.execute({
            reason: 'billing',
            context: 'ctx',
          })
          return { agentId: 'triage', output: 'output', durationMs: 10 }
        }
        return { agentId: agent.id, output: 'done', durationMs: 10 }
      }
      const swarm = createSwarm(executor)

      await swarm({
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

      let capturedTools: Record<string, any> | undefined
      const executor: AgentExecutor = async (a, options) => {
        if (a.id === 'filtered') capturedTools = options.tools as any
        return { agentId: a.id, output: 'done', durationMs: 10 }
      }
      const swarm = createSwarm(executor)

      await swarm({
        agents: { filtered: agent, helper },
        startAgent: 'filtered',
        input: {},
      })

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

      let capturedTools: Record<string, any> | undefined
      const executor: AgentExecutor = async (a, options) => {
        if (a.id === 'agent') capturedTools = options.tools as any
        return { agentId: a.id, output: 'done', durationMs: 10 }
      }
      const swarm = createSwarm(executor)

      await swarm({
        agents: { agent, helper },
        startAgent: 'agent',
        input: {},
        activeTools: { agent: ['search'] }, // swarm overrides to just search
      })

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

      let capturedTools: Record<string, any> | undefined
      const executor: AgentExecutor = async (a, options) => {
        if (a.id === 'unfiltered') capturedTools = options.tools as any
        return { agentId: a.id, output: 'done', durationMs: 10 }
      }
      const swarm = createSwarm(executor)

      await swarm({
        agents: { unfiltered: agent, helper },
        startAgent: 'unfiltered',
        input: {},
      })

      expect(capturedTools!['search']).toBeDefined()
      expect(capturedTools!['admin']).toBeDefined()
      expect(capturedTools!['transfer_to_helper']).toBeDefined()
    })
  })

  describe('cost tracking and abort', () => {
    it('calls onCost with accumulated usage after each agent', async () => {
      const onCost = vi.fn()
      const executor: AgentExecutor = async (agent, options) => {
        if (agent.id === 'triage') {
          const tools = options.tools as any
          await tools.transfer_to_billing.execute({
            reason: 'billing',
            context: 'ctx',
          })
          return {
            agentId: 'triage',
            output: 'transferring',
            durationMs: 10,
            usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
          }
        }
        return {
          agentId: agent.id,
          output: 'done',
          durationMs: 10,
          usage: { inputTokens: 200, outputTokens: 100, totalTokens: 300 },
        }
      }
      const swarm = createSwarm(executor)

      await swarm({
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
      const executor: AgentExecutor = async (agent, options) => {
        if (agent.id === 'triage') {
          const tools = options.tools as any
          await tools.transfer_to_billing.execute({
            reason: 'billing',
            context: 'ctx',
          })
          return {
            agentId: 'triage',
            output: 'transferring',
            durationMs: 10,
            usage: { totalTokens: 100 },
          }
        }
        return { agentId: agent.id, output: 'done', durationMs: 10 }
      }
      const swarm = createSwarm(executor)

      const result = await swarm({
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
      const executor = vi.fn()
      const swarm = createSwarm(executor as any)

      const result = await swarm({
        agents: { triage: triageAgent2, billing: billingAgent2 },
        startAgent: 'triage',
        input: {},
        dryRun: true,
        maxHandoffs: 5,
      })

      expect(executor).not.toHaveBeenCalled()
      expect(result.agentCount).toBe(2)
      expect(result.maxPossibleHops).toBe(5)
    })
  })

  it('propagates agent execution errors and emits composition:end', async () => {
    const executor: AgentExecutor = async (agent) => {
      if (agent.id === 'triage') throw new Error('Agent crashed')
      return { agentId: agent.id, output: 'ok', durationMs: 10 }
    }
    const swarm = createSwarm(executor)

    await expect(
      swarm({
        agents: { triage: triageAgent2, billing: billingAgent2 },
        startAgent: 'triage',
        input: {},
      }),
    ).rejects.toThrow('Agent crashed')
  })

  describe('instrumentation', () => {
    let originalRuntime: any
    let mockHooks: Record<string, ReturnType<typeof vi.fn>>

    beforeEach(() => {
      originalRuntime = { ...getRuntime() }
      mockHooks = {
        onCompositionStart: vi.fn(),
        onCompositionAgent: vi.fn(),
        onCompositionEnd: vi.fn(),
      }
      setRuntime({
        instrumentationHooks: mockHooks as any,
      })
    })

    afterEach(() => {
      setRuntime(originalRuntime)
    })

    it('emits composition:start with kind swarm and metadata', async () => {
      const executor = createSwarmExecutor({
        triage: { output: 'done' },
      })
      const swarm = createSwarm(executor)

      await swarm({
        agents: { triage: triageAgent2, billing: billingAgent2 },
        startAgent: 'triage',
        input: {},
        maxHandoffs: 5,
      })

      expect(mockHooks.onCompositionStart).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'swarm',
          agentIds: expect.arrayContaining(['triage', 'billing']),
          startAgent: 'triage',
          maxHandoffs: 5,
        }),
      )

      // Composition events now flow only through hooks, not collector
      expect(mockHooks.onCompositionStart).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'swarm',
          startAgent: 'triage',
        }),
      )
    })

    it('emits composition:agent for each agent execution with handoff metadata', async () => {
      const executor = createSwarmExecutor({
        triage: { transfer: 'billing', reason: 'billing issue' },
        billing: { output: 'resolved' },
      })
      const swarm = createSwarm(executor)

      await swarm({
        agents: { triage: triageAgent2, billing: billingAgent2 },
        startAgent: 'triage',
        input: {},
      })

      expect(mockHooks.onCompositionAgent).toHaveBeenCalledTimes(2)

      // First agent: triage (no handoffFrom since it's the entry)
      expect(mockHooks.onCompositionAgent).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          agentId: 'triage',
          index: 0,
          status: 'success',
        }),
      )

      // Second agent: billing (handoffFrom triage)
      expect(mockHooks.onCompositionAgent).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          agentId: 'billing',
          index: 1,
          status: 'success',
          handoffFrom: 'triage',
          handoffReason: 'billing issue',
          hopNumber: 1,
        }),
      )
    })

    it('emits composition:end with swarm metadata on success', async () => {
      const executor = createSwarmExecutor({
        triage: { transfer: 'billing', reason: 'billing' },
        billing: { output: 'done' },
      })
      const swarm = createSwarm(executor)

      await swarm({
        agents: { triage: triageAgent2, billing: billingAgent2 },
        startAgent: 'triage',
        input: {},
      })

      expect(mockHooks.onCompositionEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'swarm',
          status: 'success',
          agentCount: 2,
          handoffPath: ['triage', 'billing'],
          handoffCount: 1,
          finalAgentId: 'billing',
        }),
      )

      // Composition events now flow only through hooks, not collector
      expect(mockHooks.onCompositionEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          handoffPath: ['triage', 'billing'],
          finalAgentId: 'billing',
        }),
      )
    })

    it('emits composition:end with status error when maxHandoffs exceeded', async () => {
      const executor = createSwarmExecutor({
        triage: { transfer: 'billing', reason: 'loop' },
        billing: { transfer: 'triage', reason: 'loop' },
      })
      const swarm = createSwarm(executor)

      try {
        await swarm({
          agents: { triage: triageAgent2, billing: billingAgent2 },
          startAgent: 'triage',
          input: {},
          maxHandoffs: 2,
        })
      } catch {
        // Expected SwarmError
      }

      expect(mockHooks.onCompositionEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'swarm',
          status: 'error',
        }),
      )
    })

    it('emits composition:end with error when agent executor throws', async () => {
      const executor: AgentExecutor = async (agent) => {
        throw new Error('LLM API failed')
      }
      const swarm = createSwarm(executor)

      try {
        await swarm({
          agents: { triage: triageAgent2, billing: billingAgent2 },
          startAgent: 'triage',
          input: {},
        })
      } catch {
        // Expected
      }

      expect(mockHooks.onCompositionAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'triage',
          status: 'error',
          error: 'LLM API failed',
        }),
      )
      expect(mockHooks.onCompositionEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'swarm',
          status: 'error',
        }),
      )
    })
  })
})
