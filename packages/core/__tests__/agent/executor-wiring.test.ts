/**
 * Wiring tests for the agent compositions — how `parallel()`, `pipeline()`,
 * `consensus()`, and `swarm()` actually *drive* an `AgentExecutor`.
 *
 * Everything goes through the shared `createFakeAgentExecutor()` fake, whose
 * `.calls` record lets us assert exactly what each composition passed to the
 * executor (input/model/tools), how errors bubble, how results accumulate,
 * how the execution context is threaded parent→child, and which
 * instrumentation hooks fire. The real SDK executor lives in the adapter
 * packages; this pins the core-side wiring without one.
 */

import { afterEach, describe, it, expect } from 'vitest'
import { z } from 'zod'
import { prompt as makePrompt } from '../../src/prompt/prompt'
import { agent as makeAgent } from '../../src/agent/agent'
import { createParallel } from '../../src/agent/parallel'
import { createPipeline } from '../../src/agent/pipeline'
import { createConsensus } from '../../src/agent/consensus'
import { createSwarm } from '../../src/agent/swarm'
import { createFakeAgentExecutor } from '../../src/agent/fakes'
import { createFakeAgentExecutor as fromAgentBarrel } from '../../src/agent'
import { createFakeAgentExecutor as fromPackageRoot } from '../../src/index'
import { resetHooks } from '../../src/runtime/runtime'

afterEach(() => {
  resetHooks()
})

// ── Test agents ────────────────────────────────────────────────────

const scorePrompt = makePrompt({
  id: 'score',
  input: z.object({ content: z.string() }),
  output: z.object({ score: z.number() }),
  system: 'Scorer',
})
const tagPrompt = makePrompt({
  id: 'tag',
  input: z.object({ content: z.string() }),
  output: z.object({ tags: z.array(z.string()) }),
  system: 'Tagger',
})
const classifyPrompt = makePrompt({
  id: 'classify',
  input: z.object({ text: z.string() }),
  output: z.object({ category: z.string() }),
  system: 'Classifier',
})
const triagePrompt = makePrompt({ id: 'triage', system: 'Triage' })

const scorer = makeAgent({ id: 'scorer', prompt: scorePrompt })
const tagger = makeAgent({ id: 'tagger', prompt: tagPrompt })
const editor = makeAgent({ id: 'editor', prompt: scorePrompt })
const classifier = makeAgent({ id: 'classifier', prompt: classifyPrompt })
const triage = makeAgent({ id: 'triage', prompt: triagePrompt, handoffs: [] })

// ── Option threading ───────────────────────────────────────────────

describe('option threading', () => {
  it('pipeline passes each step its accumulated input and the shared model', async () => {
    const executor = createFakeAgentExecutor({ fallback: 'echo' })
    const pipeline = createPipeline(executor)

    await pipeline({
      context: { seed: 1 },
      model: 'pipe-model',
      steps: [
        { name: 'first', agent: scorer },
        { name: 'second', agent: tagger },
      ],
    })

    expect(executor.calls).toHaveLength(2)
    expect(executor.calls[0]?.options.model).toBe('pipe-model')
    expect(executor.calls[0]?.options.input).toEqual({ seed: 1 })
    // The second step receives the accumulated context (seed + first output).
    expect(executor.calls[1]?.options.input).toEqual({
      seed: 1,
      first: { _agent: 'scorer', _input: { seed: 1 } },
    })
  })

  it('parallel passes every agent the same seed context and model as input', async () => {
    const executor = createFakeAgentExecutor({
      agents: { scorer: { output: { score: 1 } }, tagger: { output: { tags: [] } } },
    })
    const parallel = createParallel(executor)

    await parallel({
      context: { content: 'hello' },
      model: 'par-model',
      agents: { scorer, tagger },
    })

    expect(executor.calls).toHaveLength(2)
    for (const call of executor.calls) {
      expect(call.options.input).toEqual({ content: 'hello' })
      expect(call.options.model).toBe('par-model')
    }
  })
})

// ── Error bubbling ─────────────────────────────────────────────────

describe('error bubbling', () => {
  it('parallel fail-fast rejects with the executor error', async () => {
    const executor = createFakeAgentExecutor({
      agents: { scorer: { output: { score: 1 } }, tagger: { throws: 'tagger failed' } },
    })
    const parallel = createParallel(executor)

    await expect(parallel({ context: { content: 'x' }, agents: { scorer, tagger } })).rejects.toThrow(
      'tagger failed',
    )
  })

  it('parallel continue mode reports the failure in its settled slot', async () => {
    const executor = createFakeAgentExecutor({
      agents: { scorer: { output: { score: 1 } }, tagger: { throws: 'tagger failed' } },
    })
    const parallel = createParallel(executor)

    const result = await parallel({
      context: { content: 'x' },
      agents: { scorer, tagger },
      onError: 'continue',
    })

    expect(result.settled?.scorer.status).toBe('success')
    expect(result.settled?.tagger.status).toBe('error')
    expect(result.settled?.tagger.error?.message).toBe('tagger failed')
  })

  it('pipeline aborts the chain at the failing step — later steps never run', async () => {
    const executor = createFakeAgentExecutor({
      agents: { scorer: { output: {} }, tagger: { throws: 'boom' }, editor: { output: {} } },
    })
    const pipeline = createPipeline(executor)

    await expect(
      pipeline({
        context: {},
        steps: [
          { name: 'a', agent: scorer },
          { name: 'b', agent: tagger },
          { name: 'c', agent: editor },
        ],
      }),
    ).rejects.toThrow('Pipeline step "b" failed')

    // editor (step c) is never reached after b throws.
    expect(executor.calls.map((c) => c.agent.id)).toEqual(['scorer', 'tagger'])
  })

  it('consensus inherits parallel fail-fast and rejects', async () => {
    const executor = createFakeAgentExecutor({ agents: { classifier: { throws: 'classifier down' } } })
    const consensus = createConsensus(executor)

    await expect(
      consensus({
        agents: [classifier, classifier],
        input: { text: 'x' },
        extract: (r) => r.output.category,
      }),
    ).rejects.toThrow('classifier down')
  })

  it('swarm surfaces an executor error from the active agent', async () => {
    const executor = createFakeAgentExecutor({ agents: { triage: { throws: 'swarm crash' } } })
    const swarm = createSwarm(executor)

    await expect(swarm({ agents: { triage }, startAgent: 'triage', input: {} })).rejects.toThrow('swarm crash')
  })
})

// ── Result accumulation ────────────────────────────────────────────

describe('result accumulation', () => {
  it('pipeline threads each step output into the next step and exposes finalOutput', async () => {
    const executor = createFakeAgentExecutor({ fallback: 'echo' })
    const pipeline = createPipeline(executor)

    const result = await pipeline({
      context: { x: 1 },
      steps: [
        { name: 'one', agent: scorer },
        { name: 'two', agent: tagger },
      ],
    })

    const context = result.context as Record<string, unknown>
    expect(context.one).toEqual({ _agent: 'scorer', _input: { x: 1 } })
    expect(context.two).toEqual({
      _agent: 'tagger',
      _input: { x: 1, one: { _agent: 'scorer', _input: { x: 1 } } },
    })
    expect(result.finalOutput).toEqual(context.two)
    expect(result.results).toHaveLength(2)
  })

  it('parallel returns a record keyed by composition key, each carrying its agent output', async () => {
    const executor = createFakeAgentExecutor({
      agents: { scorer: { output: { score: 0.5 } }, tagger: { output: { tags: ['a'] } } },
    })
    const parallel = createParallel(executor)

    const { results } = await parallel({
      context: { content: 'x' },
      agents: { rev: scorer, tag: tagger },
    })

    expect(results.rev.output).toEqual({ score: 0.5 })
    expect(results.tag.output).toEqual({ tags: ['a'] })
    // agentId reflects the underlying agent, the key reflects the composition slot.
    expect(results.rev.agentId).toBe('scorer')
    expect(results.tag.agentId).toBe('tagger')
  })
})

// ── Execution-context threading ────────────────────────────────────

describe('execution-context threading', () => {
  it('parallel runs each agent under a child context labelled with its key', async () => {
    const executor = createFakeAgentExecutor({
      agents: { scorer: { output: {} }, tagger: { output: {} } },
    })
    const parallel = createParallel(executor)

    await parallel({
      context: { content: 'x' },
      agents: { reviewer: scorer, checker: tagger },
    })

    const byId = (id: string) => executor.calls.find((c) => c.agent.id === id)
    expect(byId('scorer')?.executionContext?.stepLabel).toBe('reviewer')
    expect(byId('tagger')?.executionContext?.stepLabel).toBe('checker')
  })

  it('a parallel nested in a pipeline step sees a child context under the parent session', async () => {
    const executor = createFakeAgentExecutor({ fallback: 'echo' })
    const parallel = createParallel(executor)
    const pipeline = createPipeline(executor)

    await pipeline({
      context: { content: 'seed' },
      sessionId: 'sess-1',
      steps: [
        { name: 'outer', agent: scorer },
        { name: 'fan', fn: async () => parallel({ context: { content: 'inner' }, agents: { inner: tagger } }) },
      ],
    })

    const outer = executor.calls.find((c) => c.agent.id === 'scorer')
    expect(outer?.executionContext?.stepLabel).toBe('outer')
    expect(outer?.executionContext?.sessionId).toBe('sess-1')

    // The nested parallel agent runs under its own child label, inheriting the
    // parent's session id (parallel didn't override it).
    const inner = executor.calls.find((c) => c.agent.id === 'tagger')
    expect(inner?.executionContext?.stepLabel).toBe('inner')
    expect(inner?.executionContext?.sessionId).toBe('sess-1')
  })
})

// ── Export surface ─────────────────────────────────────────────────

describe('shared fake export surface', () => {
  it('is exported from both @use-crux/core/agent and the package root', () => {
    expect(typeof fromAgentBarrel).toBe('function')
    expect(typeof fromPackageRoot).toBe('function')
    expect(fromAgentBarrel).toBe(createFakeAgentExecutor)
    expect(fromPackageRoot).toBe(createFakeAgentExecutor)
  })
})
