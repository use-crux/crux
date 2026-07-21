/** Generate/stream terminal and cancellation parity for native client tools. */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { TimeoutError } from '@use-crux/core'
import { prompt } from '@use-crux/core'
import {
  boundary,
  guardrail,
  GuardrailBlockedError,
} from '@use-crux/core/safety'
import { createCruxAi } from '../src'
import {
  capturingEmissionModel,
  capturingStreamingEmissionModel,
} from './mock-model'

const toolPrompt = prompt({
  id: 'ai-sdk-tool-model-ingress-stream',
  prompt: 'Use the lookup tool.',
})

describe('AI SDK streaming tool model ingress', () => {
  it('writes rewritten native tool text into the next streamed provider step', async () => {
    const seen: string[] = []
    const { model, prompts } = capturingStreamingEmissionModel([
      { toolCalls: [{ id: 'call-stream-text', name: 'lookup', args: {} }] },
      { text: 'done' },
    ])
    const result = await createCruxAi().stream(toolPrompt, {
      model,
      tools: {
        lookup: {
          description: 'lookup',
          inputSchema: z.object({}),
          execute: async () => 'private',
        },
      },
      guardrails: [
        guardrail({
          id: 'rewrite-ai-sdk-stream-tool-text',
          on: boundary.input.text({ from: 'tool' }),
          run: (text) => {
            seen.push(text)
            return {
              action: 'rewrite',
              value: 'safe',
              rewrite: { kind: 'redact' },
            }
          },
        }),
      ],
    })

    let text = ''
    for await (const delta of result.textStream) text += delta
    const completion = await result.completion

    expect(text).toBe('done')
    expect(completion.text).toBe('done')
    expect(seen).toEqual(['private'])
    expect(prompts).toHaveLength(2)
    expect(providerToolOutput(prompts[1])).toEqual({
      type: 'text',
      value: 'safe',
    })
  })

  it('surfaces the same terminal error and prevents streamed continuation', async () => {
    const { model, prompts } = capturingStreamingEmissionModel([
      { toolCalls: [{ id: 'call-stream-block', name: 'lookup', args: {} }] },
      { text: 'must not continue' },
    ])
    const result = await createCruxAi().stream(toolPrompt, {
      model,
      tools: {
        lookup: {
          description: 'lookup',
          inputSchema: z.object({}),
          execute: async () => 'private',
        },
      },
      guardrails: [blockToolText('block-ai-sdk-stream-tool')],
    })
    const completionError = result.completion
      .then(() => undefined)
      .catch((cause: unknown) => cause)
    const streamError = consume(result.textStream)
      .then(() => undefined)
      .catch((cause: unknown) => cause)

    const [completionCause, streamCause] = await Promise.all([
      completionError,
      streamError,
    ])

    expect(completionCause).toBeInstanceOf(GuardrailBlockedError)
    expect(completionCause).toMatchObject({
      guardrailId: 'block-ai-sdk-stream-tool',
      phase: 'input',
      reason: 'unsafe tool text',
    })
    expect(streamCause).toBeInstanceOf(GuardrailBlockedError)
    expect(streamCause).toMatchObject({
      guardrailId: 'block-ai-sdk-stream-tool',
      phase: 'input',
      reason: 'unsafe tool text',
    })
    expect(prompts).toHaveLength(1)
  })

  it('propagates total-timeout cancellation while tool ingress is pending', async () => {
    let started!: () => void
    let release!: () => void
    const policyStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const { model, prompts } = capturingEmissionModel([
      { toolCalls: [{ id: 'call-abort', name: 'lookup', args: {} }] },
      { text: 'must not continue' },
    ])

    const pending = createCruxAi().generate(toolPrompt, {
      model,
      timeout: { totalMs: 20 },
      tools: {
        lookup: {
          description: 'lookup',
          inputSchema: z.object({}),
          execute: async () => 'private',
        },
      },
      guardrails: [
        guardrail({
          id: 'hold-ai-sdk-tool-ingress',
          on: boundary.input.text({ from: 'tool' }),
          run: async () => {
            started()
            await held
            return { action: 'allow' }
          },
        }),
      ],
    })
    const observed = pending.then(
      () => undefined,
      (cause: unknown) => cause,
    )

    await policyStarted
    await new Promise((resolve) => setTimeout(resolve, 30))
    release()

    expect(await observed).toMatchObject({
      name: 'TimeoutError',
      budget: 'total',
      limitMs: 20,
    } satisfies Partial<TimeoutError>)
    expect(prompts).toHaveLength(1)
  })
})

function blockToolText(id: string) {
  return guardrail({
    id,
    on: boundary.input.text({ from: 'tool' }),
    run: () => ({ action: 'block' as const, reason: 'unsafe tool text' }),
  })
}

async function consume(stream: AsyncIterable<string>): Promise<void> {
  for await (const _delta of stream) {
    // Consumption drives the SDK-owned tool loop.
  }
}

function providerToolOutput(prompt: unknown[] | undefined): unknown {
  const message = prompt?.find(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      'role' in entry &&
      entry.role === 'tool',
  ) as { content?: Array<{ output?: unknown }> } | undefined
  return message?.content?.[0]?.output
}
