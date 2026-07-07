import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { prompt, resetHooks, setHooks } from '@use-crux/core'
import type { CruxHooks } from '@use-crux/core'
import { resolve } from '@use-crux/ai/agent'
import { emissionModel } from './mock-model'

type ResolveEvent = Parameters<NonNullable<CruxHooks['resolveHook']>>[0]
type ExecutionEvent = Parameters<NonNullable<CruxHooks['executionHook']>>[0]

interface GeneratableModel {
  doGenerate(options: unknown): Promise<unknown>
}

afterEach(() => {
  resetHooks()
})

describe('@use-crux/ai/agent', () => {
  it('resolves instructions and wraps the AI SDK model with tracing middleware', async () => {
    const resolveEvents: ResolveEvent[] = []
    const executionEvents: ExecutionEvent[] = []

    setHooks({
      resolveHook(event) {
        resolveEvents.push(event)
        return { traceId: 'resolve-trace-1' }
      },
      executionHook(event) {
        executionEvents.push(event)
      },
    })

    const agentPrompt = prompt({
      id: 'agent-boundary',
      input: z.object({ topic: z.string() }),
      system: ({ input }) => `Explain ${input.topic} carefully.`,
    })
    const model = emissionModel([{ text: 'Done.' }]) as unknown as LanguageModelV3

    const resolved = await resolve(agentPrompt, {
      model,
      input: { topic: 'package boundaries' },
      tools: ['searchDocs'],
    })

    expect(resolved.instructions).toBe('Explain package boundaries carefully.')
    expect(resolved.model).not.toBe(model)
    expect(resolveEvents).toHaveLength(1)
    expect(resolveEvents[0]?.inspect.tools).toEqual(expect.arrayContaining(['searchDocs']))

    await (resolved.model as unknown as GeneratableModel).doGenerate({ prompt: [] })

    expect(executionEvents).toHaveLength(1)
    expect(executionEvents[0]).toMatchObject({
      promptId: 'agent-boundary',
      parentResolveTraceId: 'resolve-trace-1',
      usage: { inputTokens: 5, outputTokens: 7 },
      resolveInspect: expect.objectContaining({
        tools: expect.arrayContaining(['searchDocs']),
      }),
    })
  })
})
