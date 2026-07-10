import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { prompt } from '../../src/prompt/prompt'
import { loopRuntimeAdapter } from '../../src/adapter'
import { fakeLoopRuntime } from '../../src/adapter/testing'
import {
  clearGenerationInterceptor,
  setGenerationInterceptor,
  type InterceptedGeneration,
} from '../../src/adapter/interception'

const textPrompt = prompt({
  id: 'intercept.text',
  input: z.object({ q: z.string() }),
  system: 'You are terse.',
  prompt: ({ input }) => input.q,
})

const structuredPrompt = prompt({
  id: 'intercept.structured',
  input: z.object({ q: z.string() }),
  output: z.object({ answer: z.string() }),
  prompt: ({ input }) => input.q,
})

  afterEach(() => {
  clearGenerationInterceptor()
})

describe('generation interception at the executor boundary', () => {
  it('is transparent when no interceptor is installed', async () => {
    const fake = fakeLoopRuntime({ loops: [[{ text: 'live answer' }]] })
    const executor = loopRuntimeAdapter(fake.runtime)
    const result = await executor.generate(textPrompt, { model: 'fake:m1', input: { q: 'hi' } })
    expect(result.text).toBe('live answer')
  })

    it('sees loop calls with prompt identity, content, model, and settings', async () => {
    const seen: InterceptedGeneration[] = []
    setGenerationInterceptor((call, execute) => {
      seen.push(call)
      return execute()
    })

    const fake = fakeLoopRuntime({ loops: [[{ text: 'ok' }]] })
    const executor = loopRuntimeAdapter(fake.runtime)
    await executor.generate(textPrompt, {
      model: 'fake:m1',
      input: { q: 'question text' },
      settings: { temperature: 0 },
    })

    expect(seen).toHaveLength(1)
    const call = seen[0]!
    expect(call.kind).toBe('loop')
    expect(call.promptId).toBe('intercept.text')
    expect(call.modelInfo).toEqual({ provider: 'fake', modelId: 'm1' })
    expect(call.system).toContain('You are terse.')
    expect(call.prompt).toBe('question text')
    expect(call.settings).toMatchObject({ temperature: 0 })
  })

    it('sees structured calls and can short-circuit them without touching the spec', async () => {
    setGenerationInterceptor(async (call) => {
      expect(call.kind).toBe('structured')
      return {
        status: 'ok',
        raw: undefined,
        response: {
          text: '{"answer":"replayed"}',
          toolCalls: undefined,
          usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, inputTokenDetails: {}, outputTokenDetails: {} },
          finishReason: 'stop',
          responseId: undefined,
          actualModelId: 'm1',
        },
        object: { answer: 'replayed' },
      }
    })

    const fake = fakeLoopRuntime({ structured: ['{"answer":"live"}'] })
    const executor = loopRuntimeAdapter(fake.runtime)
    const result = await executor.generate(structuredPrompt, { model: 'fake:m1', input: { q: 'x' } })

    expect(result.object).toEqual({ answer: 'replayed' })
    expect(fake.calls.runStructuredAttempt).toHaveLength(0)
  })

    it('intercepts each model call separately during validation retry (distinct messages)', async () => {
    const seen: InterceptedGeneration[] = []
    setGenerationInterceptor((call, execute) => {
      seen.push(call)
      return execute()
    })

    const fake = fakeLoopRuntime({ structured: ['not json', '{"answer":"ok"}'] })
    const executor = loopRuntimeAdapter(fake.runtime)
    await executor.generate(structuredPrompt, {
      model: 'fake:m1',
      input: { q: 'x' },
      validationRetry: { maxRetries: 2 },
    })

    expect(seen).toHaveLength(2)
    // The retry call carries corrective messages — its identity differs.
    expect(seen[0]!.messages ?? []).not.toEqual(seen[1]!.messages ?? [])
  })
})
