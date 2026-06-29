import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { prompt as makePrompt } from '../../prompt/prompt'
import { agent as makeAgent } from '../../agent/agent'
import { createPipeline } from '../../agent/pipeline'
import { createFakeAgentExecutor } from '../../agent/fakes'

// ── Test prompts + agents ───────────────────────────────────────

const researchPrompt = makePrompt({
  id: 'research',
  input: z.object({ query: z.string() }),
  output: z.object({ sources: z.array(z.string()), synthesis: z.string() }),
  system: 'Research agent',
})

const writerPrompt = makePrompt({
  id: 'writer',
  input: z.object({ findings: z.string() }),
  output: z.object({ draft: z.string() }),
  system: 'Writer agent',
})

const editorPrompt = makePrompt({
  id: 'editor',
  input: z.object({ draft: z.string() }),
  output: z.object({ final: z.string() }),
  system: 'Editor agent',
})

const researcher = makeAgent({ id: 'researcher', prompt: researchPrompt })
const writer = makeAgent({ id: 'writer', prompt: writerPrompt })
const editor = makeAgent({ id: 'editor', prompt: editorPrompt })

/** Mock executor: echoes received input as output, tagged with agent id. */
function createMockExecutor() {
  return createFakeAgentExecutor({ fallback: 'echo' })
}

// ── Pipeline tests ──────────────────────────────────────────────

describe('pipeline: context accumulation', () => {
  it('accumulates seed context + step outputs across 2 steps', async () => {
    const executor = createMockExecutor()
    const pipeline = createPipeline(executor)

    const result = await pipeline({
      context: { userId: 'u1', projectId: 'p1' },
      steps: [
        { name: 'research', agent: researcher },
        {
          name: 'write',
          agent: writer,
          input: (ctx) => {
            // ctx should have seed context + research output
            expect(ctx.userId).toBe('u1')
            expect(ctx.research).toBeDefined()
            return { findings: 'from research' }
          },
        },
      ],
    })

    // Result should have accumulated context
    expect(result.context.userId).toBe('u1')
    expect(result.context.projectId).toBe('p1')
    expect(result.context.research).toBeDefined()
    expect(result.context.write).toBeDefined()
    expect(result.finalOutput).toBe(result.context.write)
    expect(result.results).toHaveLength(2)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('passes seed context as input to first step when no input callback', async () => {
    const executor = createMockExecutor()
    const pipeline = createPipeline(executor)

    const result = await pipeline({
      context: { query: 'AI safety' },
      steps: [
        { name: 'research', agent: researcher },
        // No input callback — receives full accumulated context
      ],
    })

    // First step should have received the seed context as input
    const researchInput = (result.context.research as { _input: unknown })._input
    expect(researchInput).toEqual({ query: 'AI safety' })
  })

  it('supports plain fn steps alongside agent steps', async () => {
    const executor = createMockExecutor()
    const pipeline = createPipeline(executor)

    const result = await pipeline({
      context: { userId: 'u1' },
      steps: [
        { name: 'research', agent: researcher },
        {
          name: 'format',
          fn: async (ctx) => {
            // fn receives accumulated context
            expect(ctx.userId).toBe('u1')
            expect(ctx.research).toBeDefined()
            return { html: '<p>formatted</p>' }
          },
        },
      ],
    })

    expect(result.context.format).toEqual({ html: '<p>formatted</p>' })
  })

  it('accumulates across 3 steps', async () => {
    const executor = createMockExecutor()
    const pipeline = createPipeline(executor)

    const result = await pipeline({
      context: { userId: 'u1' },
      steps: [
        { name: 'research', agent: researcher },
        {
          name: 'write',
          agent: writer,
          input: (ctx) => ({ findings: JSON.stringify(ctx.research) }),
        },
        {
          name: 'edit',
          agent: editor,
          input: (ctx) => {
            // ctx should have all 3: seed + research + write
            expect(ctx.userId).toBe('u1')
            expect(ctx.research).toBeDefined()
            expect(ctx.write).toBeDefined()
            return { draft: 'draft text' }
          },
        },
      ],
    })

    expect(result.results).toHaveLength(3)
    expect(result.context.research).toBeDefined()
    expect(result.context.write).toBeDefined()
    expect(result.context.edit).toBeDefined()
  })

  it('stops on error and reports step name', async () => {
    const executor = createFakeAgentExecutor({
      agents: { writer: { throws: 'LLM failed' } },
      fallback: { output: {} },
    })
    const pipeline = createPipeline(executor)

    await expect(
      pipeline({
        context: {},
        steps: [
          { name: 'research', agent: researcher },
          { name: 'write', agent: writer },
        ],
      }),
    ).rejects.toThrow('Pipeline step "write" failed')
  })

  it('emits composition events to instrumentation hooks', async () => {
    const events: Array<{ type: string; data: unknown }> = []
    const { setRuntime, resetRuntime } = await import('../../runtime/runtime')

    setRuntime({
      instrumentationHooks: {
        onCompositionStart: (e) => events.push({ type: 'start', data: e }),
        onCompositionAgent: (e) => events.push({ type: 'agent', data: e }),
        onCompositionEnd: (e) => events.push({ type: 'end', data: e }),
      },
    })

    try {
      const executor = createMockExecutor()
      const pipeline = createPipeline(executor)

      await pipeline({
        context: {},
        steps: [
          { name: 'research', agent: researcher },
          { name: 'write', agent: writer },
        ],
      })

      expect(events.filter((e) => e.type === 'start')).toHaveLength(1)
      expect(events.filter((e) => e.type === 'agent')).toHaveLength(2)
      expect(events.filter((e) => e.type === 'end')).toHaveLength(1)
    } finally {
      resetRuntime()
    }
  })
})

describe('pipeline: .created capture', () => {
  it('captures CreationTool .created values into context._created', async () => {
    // Agent with a creation tool that has .created set
    const planTool = {
      description: 'Create a plan',
      parameters: z.object({ title: z.string() }),
      execute: async () => 'ok',
      created: { id: 'plan-123', title: 'My Plan' }, // simulates post-execution
    }

    const planner = makeAgent({
      id: 'planner',
      prompt: researchPrompt,
      tools: { createPlan: planTool },
    })

    // Mock executor that returns normal output
    const executor = createFakeAgentExecutor({ fallback: { output: { planned: true } } })
    const pipeline = createPipeline(executor)

    let downstreamCtx: any
    const result = await pipeline({
      context: {},
      steps: [
        { name: 'plan', agent: planner },
        {
          name: 'use',
          fn: async (ctx: any) => {
            downstreamCtx = ctx
            return { used: true }
          },
        },
      ],
    })

    expect(result.status).toBe('completed')
    if (result.status === 'completed') {
      // _created should be merged into the plan step's context entry
      expect(downstreamCtx.plan._created).toBeDefined()
      expect(downstreamCtx.plan._created.createPlan).toEqual({
        id: 'plan-123',
        title: 'My Plan',
      })
    }
  })

  it('omits _created when no creation tools have .created values', async () => {
    const executor = createMockExecutor()
    const pipeline = createPipeline(executor)

    let downstreamCtx: any
    const result = await pipeline({
      context: {},
      steps: [
        { name: 'research', agent: researcher }, // no tools with .created
        {
          name: 'check',
          fn: async (ctx: any) => {
            downstreamCtx = ctx
            return {}
          },
        },
      ],
    })

    expect(result.status).toBe('completed')
    // No _created key should exist
    expect(downstreamCtx.research._created).toBeUndefined()
  })
})