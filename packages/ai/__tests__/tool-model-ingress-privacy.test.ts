/** Privacy-safe provider-file and opaque native tool projections. */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { prompt } from '@use-crux/core'
import {
  boundary,
  guardrail,
  SafetyResultError,
} from '@use-crux/core/safety'
import { createCruxAi } from '../src'
import type { AiSdkToolResultOutput } from '../src/sdk-codec/tool-model-ingress'
import { capturingEmissionModel } from './mock-model'

const toolPrompt = prompt({
  id: 'ai-sdk-tool-model-ingress-privacy',
  prompt: 'Use the lookup tool.',
})

describe('AI SDK tool ingress privacy', () => {
  it('evaluates sorted redacted provider projections behind one descriptor', async () => {
    const providers: string[] = []
    const rawIds = ['secret-zeta', 'secret-alpha', 'secret-duplicate', 'secret-empty']
    const { model } = capturingEmissionModel([
      { toolCalls: [{ id: 'call-files', name: 'lookup', args: {} }] },
      { text: 'done' },
    ])

    const result = await createCruxAi().generate(toolPrompt, {
      model,
      tools: {
        lookup: {
          description: 'lookup',
          inputSchema: z.object({}),
          execute: async () => 'raw',
          toModelOutput: (): AiSdkToolResultOutput => ({
            type: 'content',
            value: [
              {
                type: 'file-id',
                fileId: {
                  ' zeta ': rawIds[0],
                  alpha: rawIds[1],
                  ' alpha ': rawIds[2],
                  '': rawIds[3],
                },
              },
              { type: 'text', text: 'visible' },
            ],
          }),
        },
      },
      guardrails: [
        guardrail({
          id: 'inspect-ai-sdk-provider-files',
          on: boundary.input.media({ from: 'tool' }),
          run: (subject) => {
            const source = subject.part.source
            expect(source).toMatchObject({
              type: 'provider-file',
              fileId: '<redacted>',
            })
            if (
              typeof source === 'object' &&
              source !== null &&
              'type' in source &&
              source.type === 'provider-file' &&
              'provider' in source &&
              typeof source.provider === 'string'
            ) {
              providers.push(source.provider)
            }
            return { action: 'allow' }
          },
        }),
        guardrail({
          id: 'inspect-ai-sdk-file-descriptor',
          on: boundary.input.text({ from: 'tool' }),
          run: (text) => {
            expect(text).toBe('[file provider-file]\nvisible')
            return { action: 'allow' }
          },
        }),
      ],
    })

    expect(providers).toEqual(['<unknown>', 'alpha', 'zeta'])
    const audit = JSON.stringify(result._meta.guardrails)
    for (const rawId of rawIds) expect(audit).not.toContain(rawId)
  })

  it('removes one native provider-file slot on first strip and short-circuits its projections', async () => {
    const providers: string[] = []
    const textSeen: string[] = []
    const { model, prompts } = capturingEmissionModel([
      { toolCalls: [{ id: 'call-strip-files', name: 'lookup', args: {} }] },
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
              {
                type: 'image-file-id',
                fileId: { alpha: 'raw-a', beta: 'raw-b', zeta: 'raw-z' },
              },
              { type: 'text', text: 'visible' },
            ],
          }),
        },
      },
      guardrails: [
        guardrail({
          id: 'strip-second-ai-sdk-provider-file',
          on: boundary.input.media({ from: 'tool' }),
          run: (subject) => {
            const source = subject.part.source
            if (
              typeof source !== 'object' ||
              source === null ||
              !('type' in source) ||
              source.type !== 'provider-file' ||
              !('provider' in source) ||
              typeof source.provider !== 'string'
            ) {
              throw new Error('expected provider file')
            }
            providers.push(source.provider)
            return source.provider === 'beta'
              ? { action: 'strip', reason: 'remove native slot' }
              : { action: 'allow' }
          },
        }),
        guardrail({
          id: 'inspect-text-after-provider-strip',
          on: boundary.input.text({ from: 'tool' }),
          run: (text) => {
            textSeen.push(text)
            return { action: 'allow' }
          },
        }),
      ],
    })

    expect(providers).toEqual(['alpha', 'beta'])
    expect(textSeen).toEqual(['visible'])
    expect(providerToolOutput(prompts[1])).toEqual({
      type: 'content',
      value: [{ type: 'text', text: 'visible' }],
    })
  })

  it('fails closed when a text rewrite alters an opaque custom sentinel', async () => {
    const { model, prompts } = capturingEmissionModel([
      { toolCalls: [{ id: 'call-custom', name: 'lookup', args: {} }] },
      { text: 'must not continue' },
    ])
    const secret = 'native-provider-secret'

    const error = await createCruxAi()
      .generate(toolPrompt, {
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
                {
                  type: 'custom',
                  providerOptions: { test: { privateSetting: secret } },
                },
                { type: 'text', text: 'tail' },
              ],
            }),
          },
        },
        guardrails: [
          guardrail({
            id: 'mutate-ai-sdk-custom-sentinel',
            on: boundary.input.text({ from: 'tool' }),
            run: (text) => ({
              action: 'rewrite',
              value: text.replace('[opaque custom]', ''),
              rewrite: { kind: 'normalize' },
            }),
          }),
        ],
      })
      .then(() => undefined)
      .catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(SafetyResultError)
    expect(String(error)).not.toContain(secret)
    expect(prompts).toHaveLength(1)
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
