import { afterEach, describe, it, expect, vi } from 'vitest'
import { prompt as makePrompt } from '@use-crux/core'
import { agent as makeAgent } from '@use-crux/core/agent'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '@use-crux/core/observability'
import { z } from 'zod'
import { createConvexSwarm, createComponentSwarm } from '../src/swarm'

const triagePrompt = makePrompt({ id: 'triage', system: 'Triage agent' })
const billingPrompt = makePrompt({ id: 'billing', system: 'Billing agent' })

const triage = makeAgent({
  id: 'triage',
  description: 'Routes tickets',
  prompt: triagePrompt,
  handoffs: ['billing'],
})

const billing = makeAgent({
  id: 'billing',
  description: 'Handles billing',
  prompt: billingPrompt,
  handoffs: ['triage'],
})

afterEach(() => {
  resetObservabilityRuntime()
})

describe('createConvexSwarm', () => {
  it('creates initial state with correct defaults', () => {
    const swarm = createConvexSwarm(async () => ({ output: 'done' }))
    const state = swarm.createInitialState({
      agents: { triage, billing },
      startAgent: 'triage',
      input: { message: 'help' },
    })

    expect(state.currentAgentId).toBe('triage')
    expect(state.handoffPath).toEqual(['triage'])
    expect(state.handoffCount).toBe(0)
    expect(state.status).toBe('running')
    expect(state.maxHandoffs).toBe(10)
    expect(state.history).toBe('transfer-only')
    expect(state.flowId).toBeDefined()
    expect(state.swarmRunId).toMatch(/^swarm-/)
  })

  it('completes when agent does not hand off', async () => {
    const swarm = createConvexSwarm(async (agent) => ({
      output: `resolved by ${agent.id}`,
    }))

    const state = swarm.createInitialState({
      agents: { triage, billing },
      startAgent: 'triage',
      input: {},
    })

    const turn = await swarm.runTurn(state, { triage, billing })

    expect(turn.handedOff).toBe(false)
    expect(turn.agentId).toBe('triage')
    expect(turn.output).toBe('resolved by triage')
    expect(turn.state.status).toBe('completed')
    expect(turn.state.output).toBe('resolved by triage')
  })

  it('hands off and updates state for next turn', async () => {
    const swarm = createConvexSwarm(async (agent) => {
      if (agent.id === 'triage') {
        return {
          output: 'routing to billing',
          handoff: {
            target: 'billing',
            reason: 'billing issue',
            context: 'charged twice',
          },
        }
      }
      return { output: 'billing resolved' }
    })

    const state = swarm.createInitialState({
      agents: { triage, billing },
      startAgent: 'triage',
      input: { message: 'help' },
    })

    // Turn 1: triage hands off to billing
    const turn1 = await swarm.runTurn(state, { triage, billing })
    expect(turn1.handedOff).toBe(true)
    expect(turn1.handoffTarget).toBe('billing')
    expect(turn1.state.currentAgentId).toBe('billing')
    expect(turn1.state.handoffPath).toEqual(['triage', 'billing'])
    expect(turn1.state.handoffCount).toBe(1)
    expect(turn1.state.status).toBe('running')

    // Turn 2: billing completes
    const turn2 = await swarm.runTurn(turn1.state, { triage, billing })
    expect(turn2.handedOff).toBe(false)
    expect(turn2.state.status).toBe('completed')
    expect(turn2.state.output).toBe('billing resolved')
  })

  it('errors when maxHandoffs exceeded', async () => {
    const swarm = createConvexSwarm(async (agent) => ({
      output: 'looping',
      handoff: {
        target: agent.id === 'triage' ? 'billing' : 'triage',
        reason: 'loop',
        context: 'ctx',
      },
    }))

    let state = swarm.createInitialState({
      agents: { triage, billing },
      startAgent: 'triage',
      input: {},
      maxHandoffs: 2,
    })

    // Turn 1: triage → billing
    const turn1 = await swarm.runTurn(state, { triage, billing })
    expect(turn1.handedOff).toBe(true)

    // Turn 2: billing → triage (hits maxHandoffs)
    const turn2 = await swarm.runTurn(turn1.state, { triage, billing })
    expect(turn2.handedOff).toBe(false)
    expect(turn2.state.status).toBe('error')
    expect(turn2.state.error).toContain('maxHandoffs')
  })

  it('accumulate history includes previous output', async () => {
    let billingInput: unknown
    const swarm = createConvexSwarm(async (agent, input) => {
      if (agent.id === 'billing') billingInput = input
      if (agent.id === 'triage') {
        return {
          output: 'triage analysis',
          handoff: { target: 'billing', reason: 'billing', context: 'ctx' },
        }
      }
      return { output: 'done' }
    })

    const state = swarm.createInitialState({
      agents: { triage, billing },
      startAgent: 'triage',
      input: { message: 'help' },
      history: 'accumulate',
    })

    const turn1 = await swarm.runTurn(state, { triage, billing })
    await swarm.runTurn(turn1.state, { triage, billing })

    expect(billingInput).toEqual(
      expect.objectContaining({
        message: 'help',
        _previousOutput: 'triage analysis',
        _handoffPath: ['triage', 'billing'],
      }),
    )
  })
})

describe('createComponentSwarm', () => {
  function createMockComponent() {
    const store: Record<string, any> = {}
    return {
      memory: {
        get: 'mock:mem:get',
        set: 'mock:mem:set',
        insert: 'mock:mem:insert',
        remove: 'mock:mem:remove',
        list: 'mock:mem:list',
      },
      swarm: {
        saveState: 'mock:saveState',
        getState: 'mock:getState',
        listRuns: 'mock:listRuns',
      },
      _store: store,
    }
  }

  function createMockCtx(component: ReturnType<typeof createMockComponent>) {
    return {
      runMutation: vi.fn(async (ref: unknown, args: Record<string, unknown>) => {
        if (ref === 'mock:saveState') {
          const id = args.swarmRunId as string
          component._store[id] = {
            ...args,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }
        }
      }),
      runQuery: vi.fn(async (ref: unknown, args: Record<string, unknown>) => {
        if (ref === 'mock:getState') return component._store[args.swarmRunId as string] ?? null
        if (ref === 'mock:listRuns') return Object.values(component._store)
        return null
      }),
      scheduler: {
        runAfter: vi.fn(async () => {}),
      },
    }
  }

  /**
   * Create a mock generate function that simulates LLM behavior.
   * When an agent should hand off, the mock calls the injected transfer tool.
   */
  function createMockGenerate(behavior: Record<string, { text: string } | { handoffTo: string; reason: string }>) {
    return async (prompt: any, options: { input: unknown; tools?: Record<string, any> }) => {
      // Find the agent ID from the prompt
      const agentId = prompt?.id ?? 'unknown'
      const action = behavior[agentId]

      if (action && 'handoffTo' in action) {
        // Simulate the LLM calling the transfer tool
        const toolName = `transfer_to_${action.handoffTo}`
        if (options.tools?.[toolName]?.execute) {
          await options.tools[toolName].execute({
            reason: action.reason,
            context: 'test context',
          })
        }
        return { text: `Transferring to ${action.handoffTo}` }
      }

      return { text: action && 'text' in action ? action.text : 'done' }
    }
  }

  it('start() persists state and completes when no handoff', async () => {
    const component = createMockComponent()
    const swarm = createComponentSwarm({
      component: component as any,
      generate: createMockGenerate({
        triage: { text: 'resolved directly' },
      }) as any,
    })

    const ctx = createMockCtx(component)
    const { swarmRunId, state } = await swarm.start(ctx as any, {
      agents: { triage, billing },
      startAgent: 'triage',
      input: { message: 'help' },
      resumeAction: 'action:resume',
    })

    expect(swarmRunId).toMatch(/^swarm-/)
    expect(state.status).toBe('completed')
    expect(state.output).toBe('resolved directly')
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled()
  })

  it('start() schedules resume on handoff', async () => {
    const component = createMockComponent()
    const swarm = createComponentSwarm({
      component: component as any,
      generate: createMockGenerate({
        triage: { handoffTo: 'billing', reason: 'billing issue' },
        billing: { text: 'billing resolved' },
      }) as any,
    })

    const resumeRef = 'action:resume'
    const ctx = createMockCtx(component)
    const { swarmRunId, state } = await swarm.start(ctx as any, {
      agents: { triage, billing },
      startAgent: 'triage',
      input: {},
      resumeAction: resumeRef,
    })

    expect(state.status).toBe('running')
    expect(state.currentAgentId).toBe('billing')
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(0, resumeRef, {
      swarmRunId,
    })
  })

  it('resume() loads state and continues to completion', async () => {
    const component = createMockComponent()
    const swarm = createComponentSwarm({
      component: component as any,
      generate: createMockGenerate({
        triage: { handoffTo: 'billing', reason: 'billing issue' },
        billing: { text: 'billing resolved' },
      }) as any,
    })

    const resumeRef = 'action:resume'
    const ctx = createMockCtx(component)

    // Start — triage hands off to billing
    const { swarmRunId } = await swarm.start(ctx as any, {
      agents: { triage, billing },
      startAgent: 'triage',
      input: {},
      resumeAction: resumeRef,
    })

    // Resume — billing completes
    const finalState = await swarm.resume(ctx as any, swarmRunId, {
      agents: { triage, billing },
      resumeAction: resumeRef,
    })

    expect(finalState).not.toBeNull()
    expect(finalState!.status).toBe('completed')
    expect(finalState!.output).toBe('billing resolved')
  })

  it('getState() returns persisted state', async () => {
    const component = createMockComponent()
    const swarm = createComponentSwarm({
      component: component as any,
      generate: createMockGenerate({
        triage: { text: 'done' },
      }) as any,
    })

    const ctx = createMockCtx(component)
    const { swarmRunId } = await swarm.start(ctx as any, {
      agents: { triage, billing },
      startAgent: 'triage',
      input: {},
      resumeAction: 'action:resume',
    })

    const state = await swarm.getState(ctx as any, swarmRunId)
    expect(state).not.toBeNull()
    expect(state!.status).toBe('completed')
  })

  it('ends the standalone run as error when start() fails', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const component = createMockComponent()
    const swarm = createComponentSwarm({
      component: component as any,
      generate: async () => {
        throw new Error('swarm turn failed')
      },
    })

    const ctx = createMockCtx(component)
    await expect(
      swarm.start(ctx as any, {
        agents: { triage, billing },
        startAgent: 'triage',
        input: {},
        resumeAction: 'action:resume',
      }),
    ).rejects.toThrow('swarm turn failed')
    await observe.flush()

    expect(transport.records.map((record) => record.type)).toContain('run:end')
    expect(transport.records.at(-1)).toMatchObject({
      type: 'run:end',
      status: 'error',
      error: {
        message: 'swarm turn failed',
      },
    })
  })

  it('ends the resumed run as error when resume() fails', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const component = createMockComponent()
    const swarm = createComponentSwarm({
      component: component as any,
      generate: createMockGenerate({
        triage: { handoffTo: 'billing', reason: 'billing issue' },
        billing: { text: 'billing resolved' },
      }) as any,
    })

    const ctx = createMockCtx(component)
    const { swarmRunId } = await swarm.start(ctx as any, {
      agents: { triage, billing },
      startAgent: 'triage',
      input: {},
      resumeAction: 'action:resume',
    })
    const failingSwarm = createComponentSwarm({
      component: component as any,
      generate: async () => {
        throw new Error('resume failed')
      },
    })

    await expect(
      failingSwarm.resume(ctx as any, swarmRunId, {
        agents: { triage, billing },
        resumeAction: 'action:resume',
      }),
    ).rejects.toThrow('resume failed')
    await observe.flush()

    const runEnds = transport.records.filter((record) => record.type === 'run:end')
    expect(runEnds.at(-1)).toMatchObject({
      type: 'run:end',
      status: 'error',
      error: {
        message: 'resume failed',
      },
    })
  })
})
