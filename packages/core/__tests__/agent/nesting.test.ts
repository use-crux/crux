import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { prompt as makePrompt } from '../../define'
import { agent as makeAgent } from '../../agent/agent'
import { createParallel } from '../../agent/parallel'
import { createPipeline } from '../../agent/pipeline'
import { createConsensus } from '../../agent/consensus'
import { createSwarm } from '../../agent/swarm'
import { createFakeAgentExecutor } from '../../agent/fakes'
// One test runs a real nested pipeline inside the executor body — a genuinely
// one-off shape the shared fake can't model (see SCRATCHPAD); it keeps a
// bespoke inline executor and reads the ambient context directly.
import type { AgentExecutor } from '../../agent/executor'
import { getExecutionContext } from '../../execution-context'
import type { ExecutionContext } from '../../execution-context'

// ── Test helpers ──────────────────────────────────────────────────

const testPrompt = makePrompt({
  id: 'test-prompt',
  input: z.object({ value: z.string() }),
  output: z.object({ result: z.string() }),
  system: 'Test agent',
})

/**
 * Shared tracing executor: returns `{ result: 'output-from-<id>' }` and, via
 * the fake's recorded `.calls`, exposes the execution context observed for
 * each agent. `ctxFor(id)` returns those contexts in call order.
 */
function createTracingExecutor() {
  const executor = createFakeAgentExecutor({
    fallback: (agent) => ({ output: { result: `output-from-${agent.id}` } }),
  })
  const ctxFor = (id: string): (ExecutionContext | undefined)[] =>
    executor.calls.filter((c) => c.agent.id === id).map((c) => c.executionContext)
  return { executor, ctxFor }
}

const agentA = makeAgent({ id: 'agent-a', prompt: testPrompt })
const agentB = makeAgent({ id: 'agent-b', prompt: testPrompt })
const agentC = makeAgent({ id: 'agent-c', prompt: testPrompt })

// ── Tests ─────────────────────────────────────────────────────────

describe('composition nesting', () => {
  it('pipeline step can run a parallel inside it', async () => {
    const { executor, ctxFor } = createTracingExecutor()
    const parallel = createParallel(executor)
    const pipeline = createPipeline(executor)

    const result = await pipeline({
      context: { value: 'start' },
      steps: [
        { name: 'first', agent: agentA },
        {
          name: 'parallel-review',
          fn: async (ctx) => {
            const merged = await parallel({
              agents: { reviewer1: agentB, reviewer2: agentC },
              input: ctx,
              merge: (r) => ({
                result: `${r.reviewer1.output.result}+${r.reviewer2.output.result}`,
              }),
            })
            return merged
          },
        },
      ],
    })

    // Pipeline completed with both steps
    expect(result.results).toHaveLength(2)
    // First step ran agent-a
    expect(ctxFor('agent-a')).toHaveLength(1)
    expect(ctxFor('agent-a')[0]?.stepLabel).toBe('first')
    // Parallel step ran agent-b and agent-c with their own trace context
    expect(ctxFor('agent-b')).toHaveLength(1)
    expect(ctxFor('agent-b')[0]?.stepLabel).toBe('reviewer1')
    expect(ctxFor('agent-c')).toHaveLength(1)
    expect(ctxFor('agent-c')[0]?.stepLabel).toBe('reviewer2')
  })

  it('pipeline nested inside another pipeline', async () => {
    const { executor, ctxFor } = createTracingExecutor()
    const pipeline = createPipeline(executor)

    const result = await pipeline({
      context: { value: 'start' },
      steps: [
        { name: 'outer-first', agent: agentA },
        {
          name: 'inner-pipeline',
          fn: async (ctx) => {
            const inner = await pipeline({
              context: ctx,
              steps: [
                { name: 'inner-first', agent: agentB },
                { name: 'inner-second', agent: agentC },
              ],
            })
            return inner.finalOutput
          },
        },
      ],
    })

    expect(result.results).toHaveLength(2)
    // Outer pipeline step had label 'outer-first'
    expect(ctxFor('agent-a')[0]?.stepLabel).toBe('outer-first')
    // Inner pipeline steps had their own labels
    expect(ctxFor('agent-b')[0]?.stepLabel).toBe('inner-first')
    expect(ctxFor('agent-c')[0]?.stepLabel).toBe('inner-second')
  })

  it('consensus inside a pipeline step', async () => {
    const { executor, ctxFor } = createTracingExecutor()
    const pipeline = createPipeline(executor)
    const consensus = createConsensus(executor)

    const result = await pipeline({
      context: { value: 'start' },
      steps: [
        { name: 'research', agent: agentA },
        {
          name: 'classify',
          fn: async (ctx) => {
            const decision = await consensus({
              agents: [agentB, agentB, agentB],
              input: ctx,
              extract: (r) => r.output.result,
            })
            return decision.result
          },
        },
      ],
    })

    expect(result.results).toHaveLength(2)
    // Research step
    expect(ctxFor('agent-a')).toHaveLength(1)
    expect(ctxFor('agent-a')[0]?.stepLabel).toBe('research')
    // Consensus ran agent-b 3 times (as voters)
    expect(ctxFor('agent-b')).toHaveLength(3)
    // Each voter gets its own trace context via parallel
    expect(ctxFor('agent-b')[0]?.stepLabel).toBe('voter-0')
    expect(ctxFor('agent-b')[1]?.stepLabel).toBe('voter-1')
    expect(ctxFor('agent-b')[2]?.stepLabel).toBe('voter-2')
  })

  it('swarm agent can run a pipeline internally via tools', async () => {
    const { executor: tracingExecutor, ctxFor } = createTracingExecutor()
    const pipeline = createPipeline(tracingExecutor)

    // Bespoke executor: one agent runs a real pipeline inside its body, which
    // the shared fake can't express. It reads its own ambient context directly.
    let pipelineRanInTool = false
    let orchestratorCtx: ExecutionContext | undefined
    const swarmExecutor: AgentExecutor = async (agent) => {
      if (agent.id === 'orchestrator') {
        orchestratorCtx = getExecutionContext()
        // Simulate an agent running a pipeline inside a tool
        const toolResult = await pipeline({
          context: { value: 'from-tool' },
          steps: [
            { name: 'sub-step-1', agent: agentB },
            { name: 'sub-step-2', agent: agentC },
          ],
        })
        pipelineRanInTool = true
        return {
          agentId: agent.id,
          output: {
            result: `orchestrated: ${(toolResult.finalOutput as { result: string }).result}`,
          },
          durationMs: 10,
        }
      }

      return {
        agentId: agent.id,
        output: { result: `done-by-${agent.id}` },
        durationMs: 10,
      }
    }

    const swarm = createSwarm(swarmExecutor)
    const orchestrator = makeAgent({
      id: 'orchestrator',
      prompt: testPrompt,
      handoffs: [],
    })

    const result = await swarm({
      agents: { orchestrator },
      startAgent: 'orchestrator',
      input: { value: 'start' },
    })

    expect(result.agentResults).toHaveLength(1)
    expect(pipelineRanInTool).toBe(true)
    // Orchestrator ran with swarm trace context
    expect(orchestratorCtx?.stepLabel).toBe('orchestrator')
    // Pipeline steps inside the tool got their own trace context
    expect(ctxFor('agent-b')[0]?.stepLabel).toBe('sub-step-1')
    expect(ctxFor('agent-c')[0]?.stepLabel).toBe('sub-step-2')
  })

  it('sessionId propagates through nested compositions', async () => {
    const { executor, ctxFor } = createTracingExecutor()
    const pipeline = createPipeline(executor)
    const parallel = createParallel(executor)

    await pipeline({
      context: { value: 'start' },
      sessionId: 'outer-session',
      steps: [
        { name: 'first', agent: agentA },
        {
          name: 'nested-parallel',
          fn: async (ctx) => {
            return parallel({
              agents: { b: agentB },
              input: ctx,
              merge: (r) => r.b.output,
              sessionId: 'inherited-session', // inner composition sets its own session
            })
          },
        },
      ],
    })

    // Outer pipeline step gets outer session
    expect(ctxFor('agent-a')[0]?.sessionId).toBe('outer-session')
    // Inner parallel gets its own session (explicit override)
    expect(ctxFor('agent-b')[0]?.sessionId).toBe('inherited-session')
  })
})