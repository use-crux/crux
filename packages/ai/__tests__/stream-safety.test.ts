/**
 * Streaming-safety fidelity: the executor mounts core's `SafetyStream` via
 * the REAL `streamText` `experimental_transform`. Proves holds buffer,
 * transforms reach the consumer's `textStream`, blocks error the stream,
 * and the completion meta carries the guardrail audit.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { z } from 'zod'
import { prompt as makePrompt, guardrail, resetHooks } from '@use-crux/core'
import { boundary } from '@use-crux/core/safety'
import { createCruxAi } from '../index'
import { streamingModel } from './mock-model'

afterEach(() => {
  resetHooks()
})

const textPrompt = makePrompt({
  id: 'stream-safety',
  system: 'You are terse.',
  prompt: ({ input }) => (input as { message: string }).message,
  input: z.object({ message: z.string() }),
})

const importFixer = () =>
  guardrail({
    id: 'import-fixer',
    on: boundary.output.text(),
    stream: 'chunk',
    run: async (chunk) => {
      if (chunk.includes('@/comps/')) {
        return {
          action: 'rewrite' as const,
          value: chunk.replace('@/comps/', '@/components/'),
          rewrite: { kind: 'normalize' as const },
        }
      }
      if (chunk.endsWith('@/co')) return { action: 'hold' as const }
      return { action: 'allow' as const }
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

    const meta = await result.completion
    expect(meta.text).toBe('import x from @/components/Button — done')
  })

  it('fails closed instead of releasing a held tail before the finish part', async () => {
    const ai = createCruxAi()
    // The final chunk ends mid-hold, so the tail is only released at seal.
    const model = streamingModel(['hello ', '@/co'])

    const result = await ai.stream(textPrompt, {
      model,
      input: { message: 'code' },
      guardrails: [importFixer()],
    })

    await expect(
      (async () => {
        for await (const _delta of result.textStream) {
          // Consume until the safety transform closes or errors.
        }
      })(),
    ).rejects.toThrow(/hold|stream|safety|result/i)

    await expect((result as unknown as { completion: Promise<{ text?: string }> }).completion).rejects.toThrow(
      /hold|stream|safety|result/i,
    )
  })

  it('applies ordinary output guardrails to streamText by default', async () => {
    const ai = createCruxAi()
    const model = streamingModel(['api key sk-', '123.'])
    const redactor = guardrail({
      id: 'default-stream-redactor',
      on: boundary.output.text(),
      run: async (content) => ({
        action: 'rewrite' as const,
        value: content.replace('sk-123', '[KEY]'),
        rewrite: { kind: 'redact' as const },
      }),
    })

    const result = await ai.stream(textPrompt, {
      model,
      input: { message: 'code' },
      guardrails: [redactor],
    })

    let streamed = ''
    for await (const delta of result.textStream) {
      streamed += delta
    }
    expect(streamed).toBe('api key [KEY].')

    const meta = await (result as unknown as { completion: Promise<{ text?: string }> }).completion
    expect(meta?.text).toBe('api key [KEY].')
  })

  it('a mid-stream block surfaces as a stream error', async () => {
    const blocker = guardrail({
      id: 'live-block',
      on: boundary.output.text(),
      stream: 'chunk',
      run: async (chunk) =>
        chunk.includes('forbidden') ? { action: 'block' as const, reason: 'nope' } : { action: 'allow' as const },
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
