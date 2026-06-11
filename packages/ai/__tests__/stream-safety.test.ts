/**
 * Streaming-safety fidelity: the executor mounts core's `SafetyStream` via
 * the REAL `streamText` `experimental_transform`. Proves holds buffer,
 * transforms reach the consumer's `textStream`, blocks error the stream,
 * and the completion meta carries the guardrail audit.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { z } from 'zod'
import { prompt as makePrompt, guardrail, resetRuntime } from '@crux/core'
import { createCruxAi } from '../index'
import { streamingModel } from './mock-model'

afterEach(() => {
  resetRuntime()
})

const textPrompt = makePrompt({
  id: 'stream-safety',
  system: 'You are terse.',
  prompt: ({ input }) => (input as { message: string }).message,
  input: z.object({ message: z.string() }),
})

const importFixer = () =>
  guardrail({
    name: 'import-fixer',
    phase: 'output',
    validate: async () => ({ action: 'pass' as const }),
    stream: { buffer: 'none' },
    onChunk: async (chunk) => {
      if (chunk.includes('@/comps/')) {
        return { action: 'transform' as const, content: chunk.replace('@/comps/', '@/components/') }
      }
      if (chunk.endsWith('@/co')) return { action: 'hold' as const }
      return { action: 'pass' as const }
    },
  })

describe('streaming safety through real streamText', () => {
  it('holds, fixes, and releases mid-stream content (LLM Suspense)', async () => {
    const ai = createCruxAi()
    const model = streamingModel(['import x from ', '@/co', 'mps/Button', ' — done'])

    const result = await ai.stream(textPrompt, {
      model,
      input: { message: 'code' },
      guardrails: [importFixer()],
    })

    let streamed = ''
    for await (const delta of result.textStream) {
      streamed += delta
    }
    expect(streamed).toBe('import x from @/components/Button — done')

    const meta = await (result as unknown as { completion: Promise<{ guardrails?: { applied: unknown[] } }> })
      .completion
    expect(meta?.guardrails?.applied).toContainEqual(
      expect.objectContaining({ guard: 'import-fixer', action: 'transform', original: '@/comps/Button' }),
    )
  })

  it('a mid-stream block surfaces as a stream error', async () => {
    const blocker = guardrail({
      name: 'live-block',
      phase: 'output',
      validate: async () => ({ action: 'pass' as const }),
      stream: { buffer: 'none' },
      onChunk: async (chunk) =>
        chunk.includes('forbidden') ? { action: 'block' as const, reason: 'nope' } : { action: 'pass' as const },
    })
    const ai = createCruxAi()
    const model = streamingModel(['fine ', 'forbidden tail'])

    const result = await ai.stream(textPrompt, {
      model,
      input: { message: 'code' },
      guardrails: [blocker],
    })

    const error = await (async () => {
      try {
        let streamed = ''
        for await (const delta of result.textStream) streamed += delta
        return undefined
      } catch (caught: unknown) {
        return caught
      }
    })()

    expect(error).toBeDefined()
  })
})
