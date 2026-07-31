/** Native AI SDK client-tool output guarded at semantic model ingress. */

import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { config, offload, prompt } from '@use-crux/core'
import { inMemoryRecordStore } from '@use-crux/core/storage'
import {
  boundary,
  guardrail,
  GuardrailBlockedError,
  toolPolicy,
} from '@use-crux/core/safety'
import { createCruxAi } from '../src'
import type { AiSdkToolResultOutput } from '../src/sdk-codec/tool-model-ingress'
import { capturingEmissionModel } from './mock-model'
import { scriptedGateway } from './scripted-gateway'

const toolPrompt = prompt({
  id: 'ai-sdk-tool-model-ingress',
  prompt: 'Use the lookup tool.',
})

describe('AI SDK tool model ingress', () => {
  it('blocks converter-introduced image data before another provider call', async () => {
    const { model, prompts } = capturingEmissionModel([
      {
        toolCalls: [
          { id: 'call-image', name: 'lookup', args: { query: 'private' } },
        ],
      },
      { text: 'must not continue' },
    ])
    const convert = vi.fn(() => ({
      type: 'content' as const,
      value: [
        {
          type: 'image-data' as const,
          data: 'AQID',
          mediaType: 'image/png',
        },
      ],
    }))

    const error = await createCruxAi()
      .generate(toolPrompt, {
        model,
        tools: {
          lookup: {
            description: 'lookup',
            inputSchema: z.object({ query: z.string() }),
            execute: async () => ({ allowed: true }),
            toModelOutput: convert,
          },
        },
        guardrails: [
          guardrail({
            id: 'block-ai-sdk-tool-image',
            on: boundary.input.media({ from: 'tool' }),
            run: (subject, context) => {
              expect(subject.part).toMatchObject({
                type: 'image',
                mediaType: 'image/png',
              })
              expect(context.origin).toEqual({
                source: 'tool',
                kind: 'tool-result',
                toolName: 'lookup',
                toolCallId: 'call-image',
                partIndex: 0,
              })
              return { action: 'block', reason: 'unsafe image' }
            },
          }),
        ],
      })
      .then(() => undefined)
      .catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(GuardrailBlockedError)
    expect(error).toMatchObject({
      guardrailId: 'block-ai-sdk-tool-image',
      phase: 'input',
      reason: 'unsafe image',
    })
    expect(convert).toHaveBeenCalledOnce()
    expect(prompts).toHaveLength(1)
  })

  it('runs raw result policy, native conversion, and canonical JSON ingress once in order', async () => {
    const events: string[] = []
    const raw = { private: true }
    const { model, prompts } = capturingEmissionModel([
      { toolCalls: [{ id: 'call-json', name: 'lookup', args: {} }] },
      { text: 'done' },
    ])

    await createCruxAi().generate(toolPrompt, {
      model,
      tools: {
        lookup: {
          description: 'lookup',
          inputSchema: z.object({}),
          execute: async () => raw,
          toModelOutput: ({ output }: { readonly output: unknown }): AiSdkToolResultOutput => {
            expect(output).toBe(raw)
            events.push('convert')
            return { type: 'json', value: output as { private: boolean } }
          },
        },
      },
      toolMiddleware: toolPolicy.result({
        id: 'inspect-ai-sdk-raw-result',
        match: 'lookup',
        run: (subject) => {
          expect(subject.output).toBe(raw)
          events.push('raw-policy')
          return { action: 'allow' }
        },
      }),
      guardrails: [
        guardrail({
          id: 'rewrite-ai-sdk-tool-json',
          on: boundary.input.text({ from: 'tool' }),
          run: (text) => {
            expect(text).toBe('{"private":true}')
            events.push('model-ingress')
            return {
              action: 'rewrite',
              value: 'exact safe JSON projection',
              rewrite: { kind: 'redact' },
            }
          },
        }),
      ],
    })

    expect(events).toEqual(['raw-policy', 'convert', 'model-ingress'])
    expect(prompts).toHaveLength(2)
    expect(providerToolOutput(prompts[1])).toEqual({
      type: 'text',
      value: 'exact safe JSON projection',
    })
  })

  it('strips native media before rewriting adjacent text for the next provider step', async () => {
    const order: string[] = []
    const image = Object.freeze({
      type: 'image-url' as const,
      url: 'https://example.com/private.png',
    })
    const { model, prompts } = capturingEmissionModel([
      { toolCalls: [{ id: 'call-mixed', name: 'lookup', args: {} }] },
      { text: 'done' },
    ])

    await createCruxAi().generate(toolPrompt, {
      model,
      tools: {
        lookup: {
          description: 'lookup',
          inputSchema: z.object({}),
          execute: async () => 'raw',
          toModelOutput: (): AiSdkToolResultOutput => ({
            type: 'content',
            value: [
              { type: 'text', text: 'private' },
              image,
              { type: 'text', text: 'tail' },
            ],
          }),
        },
      },
      guardrails: [
        guardrail({
          id: 'strip-ai-sdk-tool-image',
          on: boundary.input.media({ from: 'tool' }),
          run: () => {
            order.push('media')
            return { action: 'strip', reason: 'remove image' }
          },
        }),
        guardrail({
          id: 'rewrite-ai-sdk-tool-text',
          on: boundary.input.text({ from: 'tool' }),
          run: (text) => {
            order.push(`text:${text}`)
            return {
              action: 'rewrite',
              value: text.replace('private', 'safe'),
              rewrite: { kind: 'redact' },
            }
          },
        }),
      ],
    })

    expect(order).toEqual(['media', 'text:private\ntail'])
    expect(providerToolOutput(prompts[1])).toEqual({
      type: 'content',
      value: [
        { type: 'text', text: 'safe\ntail' },
        { type: 'text', text: '' },
      ],
    })
  })

  it('records report intent while preserving native model output', async () => {
    const { model, prompts } = capturingEmissionModel([
      { toolCalls: [{ id: 'call-report', name: 'lookup', args: {} }] },
      { text: 'done' },
    ])

    const result = await createCruxAi().generate(toolPrompt, {
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
          id: 'report-ai-sdk-tool-text',
          mode: 'report',
          on: boundary.input.text({ from: 'tool' }),
          run: () => ({
            action: 'rewrite',
            value: 'would rewrite',
            rewrite: { kind: 'redact' },
          }),
        }),
      ],
    })

    expect(providerToolOutput(prompts[1])).toEqual({
      type: 'text',
      value: 'private',
    })
    expect(result._meta.guardrails?.applied).toContainEqual(
      expect.objectContaining({
        guard: 'report-ai-sdk-tool-text',
        mode: 'report',
        action: 'redact',
      }),
    )
  })

  it('installs exact-recovery conversion without changing ordinary output', async () => {
    const scripted = scriptedGateway({ generateText: [{ text: 'done' }] })
    const authored = {
      description: 'lookup',
      inputSchema: z.object({}),
      execute: async () => ({ unchanged: true }),
    }

    await createCruxAi({ gateway: scripted.gateway }).generate(toolPrompt, {
      model: 'openai:gpt-4o' as never,
      tools: { lookup: authored },
    })

    const sent = (scripted.calls.generateText[0]?.tools as Record<string, unknown>)
      .lookup as Record<string, unknown>
    expect(sent).toHaveProperty('toModelOutput', expect.any(Function))
  })

  it('lowers a forced exact result before the next SDK provider step', async () => {
    const installation = config({
      persistence: { records: inMemoryRecordStore() },
    })
    const canonical = { exact: 'SDK Tool result' }
    const { model, prompts, toolNames } = capturingEmissionModel([
      { toolCalls: [{ id: 'call-offload', name: 'lookup', args: {} }] },
      { text: 'done' },
    ])

    try {
      await createCruxAi().generate(toolPrompt, {
        model,
        tools: {
          lookup: {
            description: 'lookup',
            inputSchema: z.object({}),
            execute: async () => offload(canonical),
          },
        },
      })

      expect(providerToolOutput(prompts[1])).toEqual({
        type: 'json',
        value: expect.objectContaining({
          type: 'exact-recovery-reference',
          handle: expect.stringMatching(/^offload_[a-f0-9]+$/),
        }),
      })
      expect(toolNames).toEqual([
        ['lookup'],
        ['lookup', '__crux_ReadOffload'],
      ])
    } finally {
      installation.dispose()
    }
  })
})

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
