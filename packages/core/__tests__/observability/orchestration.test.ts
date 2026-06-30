import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { prompt as makePrompt } from '../../prompt/prompt'
import { agent as makeAgent } from '../../agent/agent'
import { createParallel } from '../../agent/parallel'
import { createPipeline } from '../../agent/pipeline'
import { createConsensus } from '../../agent/consensus'
import { createSwarm } from '../../agent/swarm'
import { delegate } from '../../agent/delegate'
import { handoff } from '../../agent/handoff'
import { flow } from '../../flow/scope'
import type { AgentExecutor } from '../../agent/executor'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../observability'

const researchPrompt = makePrompt({
  id: 'research',
  input: z.object({ topic: z.string() }),
  output: z.object({ answer: z.string() }),
  system: 'Research',
})

const critiquePrompt = makePrompt({
  id: 'critique',
  input: z.object({ topic: z.string() }),
  output: z.object({ verdict: z.string() }),
  system: 'Critique',
})

const researchAgent = makeAgent({
  id: 'research-agent',
  prompt: researchPrompt,
})
const critiqueAgent = makeAgent({
  id: 'critique-agent',
  prompt: critiquePrompt,
})

describe('canonical orchestration observability', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('records standalone parallel runs with sibling agent spans and nested generation spans', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const executor: AgentExecutor = async (agent) =>
      observe.span(
        {
          name: `${agent.id} generate`,
          family: 'generation',
          primitive: 'generation.call',
          attributes: { agentId: agent.id },
        },
        async () => ({
          agentId: agent.id,
          output: { ok: true },
          durationMs: 1,
        }),
      )

    const parallel = createParallel(executor)
    await parallel({
      context: { topic: 'observability' },
      agents: { research: researchAgent, critique: critiqueAgent },
    })
    await observe.flush()

    const spanStarts = transport.records.filter(
      (record) => record.type === 'span:start',
    )
    const composition = spanStarts.find(
      (record) => record.primitive === 'composition.parallel',
    )
    expect(transport.records[0]).toMatchObject({
      type: 'run:start',
      rootPrimitive: 'composition.parallel',
    })
    expect(composition).toMatchObject({
      family: 'composition',
      primitive: 'composition.parallel',
    })

    const agentSpans = spanStarts.filter(
      (record) => record.primitive === 'agent.run',
    )
    expect(agentSpans).toHaveLength(2)
    expect(agentSpans.map((record) => record.parentSpanId)).toEqual([
      composition?.spanId,
      composition?.spanId,
    ])

    const generationSpans = spanStarts.filter(
      (record) => record.primitive === 'generation.call',
    )
    expect(generationSpans).toHaveLength(2)
    expect(generationSpans.map((record) => record.parentSpanId).sort()).toEqual(
      agentSpans.map((record) => record.spanId).sort(),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'composition.report',
        preview: expect.objectContaining({
          kind: 'composition.report',
          compositionType: 'parallel',
          status: 'success',
          branches: expect.arrayContaining([
            expect.objectContaining({
              id: 'research',
              agentId: 'research-agent',
              status: 'success',
            }),
            expect.objectContaining({
              id: 'critique',
              agentId: 'critique-agent',
              status: 'success',
            }),
          ]),
        }),
      }),
    )
  })

  it('records pipeline steps as canonical flow.step children', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const pipeline = createPipeline(async (agent) => ({
      agentId: agent.id,
      output: { answer: agent.id },
      durationMs: 1,
    }))

    await pipeline({
      context: { topic: 'observability' },
      steps: [
        { name: 'research', agent: researchAgent },
        { name: 'critique', fn: async () => ({ verdict: 'ok' }) },
      ],
    })
    await observe.flush()

    const spanStarts = transport.records.filter(
      (record) => record.type === 'span:start',
    )
    const pipelineSpan = spanStarts.find(
      (record) => record.primitive === 'composition.pipeline',
    )
    expect(transport.records[0]).toMatchObject({
      type: 'run:start',
      rootPrimitive: 'composition.pipeline',
    })
    expect(pipelineSpan).toBeTruthy()

    const stepSpans = spanStarts.filter(
      (record) => record.primitive === 'flow.step',
    )
    expect(stepSpans.map((record) => record.name)).toEqual([
      'research',
      'critique',
    ])
    expect(stepSpans.map((record) => record.parentSpanId)).toEqual([
      pipelineSpan?.spanId,
      pipelineSpan?.spanId,
    ])

    const agentSpan = spanStarts.find(
      (record) => record.primitive === 'agent.run',
    )
    expect(agentSpan?.parentSpanId).toBe(stepSpans[0]?.spanId)
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'composition.report',
        preview: expect.objectContaining({
          kind: 'composition.report',
          compositionType: 'pipeline',
          status: 'success',
          stages: expect.arrayContaining([
            expect.objectContaining({ name: 'research', status: 'success' }),
            expect.objectContaining({ name: 'critique', status: 'success' }),
          ]),
        }),
      }),
    )
  })

  it('records runtime flows as flow.run with canonical flow.step children', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    await flow('research flow', async (flow) => {
      const plan = await flow.step('plan', async () => ({ planId: 'p1' }))
      return flow.step('publish', async () => ({
        planId: plan.planId,
        ok: true,
      }))
    }).run()
    await observe.flush()

    const spanStarts = transport.records.filter(
      (record) => record.type === 'span:start',
    )
    const flowRun = spanStarts.find((record) => record.primitive === 'flow.run')
    expect(transport.records[0]).toMatchObject({
      type: 'run:start',
      rootPrimitive: 'flow.run',
    })
    expect(flowRun).toMatchObject({
      family: 'flow',
      primitive: 'flow.run',
      name: 'research flow',
    })

    const stepSpans = spanStarts.filter(
      (record) => record.primitive === 'flow.step',
    )
    expect(stepSpans.map((record) => record.name)).toEqual(['plan', 'publish'])
    expect(stepSpans.map((record) => record.parentSpanId)).toEqual([
      flowRun?.spanId,
      flowRun?.spanId,
    ])
  })

  it('records delegates and handoff payload relations canonically', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const contract = handoff({
      id: 'research-to-writer',
      inputSchema: z.object({ notes: z.string() }),
      outputSchema: z.object({ notes: z.string() }),
      transform: (input) => input,
    })
    const researchDelegate = delegate({
      id: 'delegate-research',
      argsSchema: z.object({ topic: z.string() }),
      handoff: contract,
      execute: async (args) => ({ notes: `notes:${args.topic}` }),
    })

    await researchDelegate.run({ topic: 'observability' }, undefined)
    await observe.flush()

    const spanStarts = transport.records.filter(
      (record) => record.type === 'span:start',
    )
    expect(transport.records[0]).toMatchObject({
      type: 'run:start',
      rootPrimitive: 'delegate.invoke',
    })
    expect(spanStarts.map((record) => record.primitive)).toContain(
      'delegate.invoke',
    )
    expect(spanStarts.map((record) => record.primitive)).toContain(
      'handoff.prepare',
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'input',
        attributes: expect.objectContaining({
          delegateId: 'delegate-research',
          role: 'delegate.input',
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'input',
        attributes: expect.objectContaining({
          handoffId: 'research-to-writer',
          role: 'handoff.input',
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'output',
        attributes: expect.objectContaining({
          delegateId: 'delegate-research',
          role: 'delegate.output',
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'delegate.report',
        preview: expect.objectContaining({
          kind: 'delegate.report',
          delegateId: 'delegate-research',
          handoffId: 'research-to-writer',
          inputSize: expect.any(Number),
          outputSize: expect.any(Number),
          resultPreview: expect.objectContaining({
            notes: 'notes:observability',
          }),
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({ type: 'artifact', kind: 'handoff.payload' }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({ type: 'edge', edgeType: 'consumed' }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({ type: 'edge', edgeType: 'produced' }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({ type: 'edge', edgeType: 'handoff.payload' }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({ type: 'edge', edgeType: 'delegate.invoked' }),
    )
  })

  it('records consensus voters under one composition runtime boundary', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const consensus = createConsensus(async (agent) => ({
      agentId: agent.id,
      output: { vote: 'ship' },
      durationMs: 1,
    }))

    await consensus({
      agents: [researchAgent, critiqueAgent],
      input: { topic: 'observability' },
      extract: (result) => (result.output as { vote: string }).vote,
      quorum: 'majority',
    })
    await observe.flush()

    const spanStarts = transport.records.filter(
      (record) => record.type === 'span:start',
    )
    const consensusSpan = spanStarts.find(
      (record) => record.primitive === 'composition.consensus',
    )
    expect(transport.records[0]).toMatchObject({
      type: 'run:start',
      rootPrimitive: 'composition.consensus',
    })
    expect(
      spanStarts.find((record) => record.primitive === 'composition.parallel'),
    ).toBeUndefined()
    expect(
      spanStarts.filter((record) => record.primitive === 'agent.run'),
    ).toEqual([
      expect.objectContaining({
        parentSpanId: consensusSpan?.spanId,
        attributes: expect.objectContaining({ index: 0 }),
      }),
      expect.objectContaining({
        parentSpanId: consensusSpan?.spanId,
        attributes: expect.objectContaining({ index: 1 }),
      }),
    ])
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'composition.report',
        preview: expect.objectContaining({
          kind: 'composition.report',
          compositionType: 'consensus',
          status: 'success',
          agreement: 1,
          quorum: 'majority',
          votes: expect.arrayContaining([
            expect.objectContaining({
              agent: 'research-agent',
              answer: 'ship',
            }),
            expect.objectContaining({
              agent: 'critique-agent',
              answer: 'ship',
            }),
          ]),
        }),
      }),
    )
  })

  it('records swarm agent turns and handoffs canonically', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const triage = makeAgent({
      id: 'triage',
      prompt: researchPrompt,
      handoffs: ['billing'],
    })
    const billing = makeAgent({
      id: 'billing',
      prompt: critiquePrompt,
      handoffs: ['triage'],
    })
    const swarm = createSwarm(async (agent, options) => {
      if (agent.id === 'triage') {
        const transfer = (
          options.tools as Record<
            string,
            {
              execute: (args: {
                reason: string
                context: string
              }) => Promise<string>
            }
          >
        ).transfer_to_billing
        await transfer.execute({
          reason: 'billing issue',
          context: 'invoice context',
        })
        return { agentId: agent.id, output: 'transfer', durationMs: 1 }
      }
      return { agentId: agent.id, output: 'done', durationMs: 1 }
    })

    await swarm({
      agents: { triage, billing },
      startAgent: 'triage',
      input: { topic: 'observability' },
      maxHandoffs: 3,
    })
    await observe.flush()

    const spanStarts = transport.records.filter(
      (record) => record.type === 'span:start',
    )
    expect(transport.records[0]).toMatchObject({
      type: 'run:start',
      rootPrimitive: 'composition.swarm',
    })
    expect(
      spanStarts.filter((record) => record.primitive === 'composition.swarm'),
    ).toHaveLength(1)
    expect(
      spanStarts.filter((record) => record.primitive === 'agent.run'),
    ).toHaveLength(2)
    expect(
      spanStarts.filter((record) => record.primitive === 'handoff.prepare'),
    ).toHaveLength(1)
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'input',
        attributes: expect.objectContaining({ role: 'handoff.input' }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'handoff.payload',
        preview: expect.objectContaining({
          kind: 'handoff.payload',
          fromAgent: 'triage',
          toAgent: 'billing',
          hop: 1,
          beforeSize: expect.any(Number),
          afterSize: expect.any(Number),
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'composition.report',
        preview: expect.objectContaining({
          kind: 'composition.report',
          compositionType: 'swarm',
          status: 'success',
          handoffPath: ['triage', 'billing'],
          handoffCount: 1,
          finalAgentId: 'billing',
          roster: expect.arrayContaining([
            expect.objectContaining({ id: 'triage', turns: 1 }),
            expect.objectContaining({ id: 'billing', turns: 1 }),
          ]),
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({ type: 'edge', edgeType: 'consumed' }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({ type: 'edge', edgeType: 'handoff.payload' }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({ type: 'edge', edgeType: 'triggered' }),
    )
  })
})
