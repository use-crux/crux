import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { LoopRuntimePort } from '../../src/adapter/loop-runtime-port'
import { loopRuntimeAdapter } from '../../src/adapter/define-executor'
import { fakeLoopRuntime } from '../../src/adapter/testing'
import { prompt } from '../../src/prompt/prompt'
import { resetObservabilityRuntime, subscribeObservability } from '../../src/observability'
import { resetHooks, updateHooks } from '../../src/runtime/runtime'

const testPrompt = prompt({
  id: 'model-identity',
  input: z.object({ instruction: z.string() }),
  prompt: ({ input }) => (input as { instruction: string }).instruction,
})

const model = Object.freeze({
  provider: 'openrouter',
  modelId: 'anthropic/claude-sonnet-4',
})

function objectModelRuntime() {
  const fake = fakeLoopRuntime({
    loops: [[{ text: 'done' }]],
    streams: [['done']],
  })
  return {
    fake,
    runtime: {
      ...fake.runtime,
      describeModel(value: typeof model) {
        return { provider: value.provider, modelId: value.modelId }
      },
    } as unknown as LoopRuntimePort<
      typeof model,
      (typeof fake.runtime) extends LoopRuntimePort<string, infer TRaw, unknown>
        ? TRaw
        : never,
      (typeof fake.runtime) extends LoopRuntimePort<string, unknown, infer TStream>
        ? TStream
        : never
    >,
  }
}

afterEach(() => {
  resetHooks()
  resetObservabilityRuntime()
})

describe('SDK model identity boundaries', () => {
  it('keeps the original model in generate middleware while tracing the normalized model ID', async () => {
    const { runtime } = objectModelRuntime()
    const executor = loopRuntimeAdapter(runtime)
    const middlewareModels: unknown[] = []
    const spanStarts: Array<{ primitive?: string; model?: string }> = []
    updateHooks({
      middleware: async (args, next) => {
        middlewareModels.push(args.model)
        return next(args)
      },
    })
    subscribeObservability(['span:start'], (record) => spanStarts.push(record))

    await executor.generate(testPrompt, {
      model,
      input: { instruction: 'generate' },
    })

    expect(middlewareModels).toEqual([model])
    expect(spanStarts).toContainEqual(
      expect.objectContaining({
        primitive: 'generation.call',
        attributes: expect.objectContaining({ model: model.modelId }),
      }),
    )
  })

  it('keeps the original model in stream middleware while tracing the normalized model ID', async () => {
    const { runtime } = objectModelRuntime()
    const executor = loopRuntimeAdapter(runtime)
    const middlewareModels: unknown[] = []
    const spanStarts: Array<{ primitive?: string; model?: string }> = []
    updateHooks({
      middleware: async (args, next) => {
        middlewareModels.push(args.model)
        return next(args)
      },
    })
    subscribeObservability(['span:start'], (record) => spanStarts.push(record))

    await executor.stream(testPrompt, {
      model,
      input: { instruction: 'stream' },
    })

    expect(middlewareModels).toEqual([model])
    expect(spanStarts).toContainEqual(
      expect.objectContaining({
        primitive: 'generation.stream',
        attributes: expect.objectContaining({ model: model.modelId }),
      }),
    )
  })
})
