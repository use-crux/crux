import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { prompt } from '@use-crux/core'
import { createCruxAi } from '../src'
import type { SdkGateway } from '../src/gateway'
import type { SdkLoopResultLike } from '../src/sdk-codec'
import { emissionModel } from './mock-model'
import { objectGenerationError } from './scripted-gateway'

describe('AI SDK managed/headless/transport equivalence', () => {
  it('matches managed generate for plain text', async () => {
    const model = emissionModel([])
    const p = prompt({
      id: 'ai-equivalence-plain',
      prompt: ({ input }) => `Say ${input.word}.`,
      input: z.object({ word: z.string() }),
    })
    const response = sdkResponse({ text: 'hello' })
    const options = { model, input: { word: 'hello' } } as const

    const managed = await createCruxAi({ gateway: gatewayFor('generateText', [response]) }).generate(p, options)
    const headless = await runHandle(p, response, options)
    const transported = await runTransport(p, [response], options)

    expect(expectComparable(headless)).toEqual(expectComparable(managed))
    expect(expectComparable(transported)).toEqual(expectComparable(managed))
  })

  it('matches managed generate for SDK-owned multi-step completions', async () => {
    const model = emissionModel([])
    const p = prompt({
      id: 'ai-equivalence-tools',
      prompt: 'Use the SDK-owned tool loop.',
    })
    const response = sdkResponse({
      text: 'done',
      steps: [
        {
          text: '',
          finishReason: 'tool-calls',
          response: { id: 'ai_step_1', modelId: 'mock-ai-sdk' },
          usage: { inputTokens: 2, outputTokens: 0, totalTokens: 2 },
        },
        {
          text: 'done',
          finishReason: 'stop',
          response: { id: 'ai_step_2', modelId: 'mock-ai-sdk' },
          usage: { inputTokens: 0, outputTokens: 3, totalTokens: 3 },
        },
      ],
    })
    const options = { model, maxSteps: 3 } as const

    const managed = await createCruxAi({ gateway: gatewayFor('generateText', [response]) }).generate(p, options)
    const headless = await runHandle(p, response, options)
    const transported = await runTransport(p, [response], options)

    expect(expectComparable(headless)).toEqual(expectComparable(managed))
    expect(expectComparable(transported)).toEqual(expectComparable(managed))
  })

  it('matches managed generate for approval suspension', async () => {
    const model = emissionModel([])
    const p = prompt({
      id: 'ai-equivalence-approval',
      prompt: 'Request approval.',
    })
    const response = sdkResponse({
      text: 'approval needed',
      content: [
        {
          type: 'tool-approval-request',
          toolCall: { toolCallId: 'call_guarded', toolName: 'guarded', input: { value: 'hello' } },
        },
      ],
    })
    const options = { model } as const

    const managed = await createCruxAi({ gateway: gatewayFor('generateText', [response]) }).generate(p, options)
    const headless = await runHandle(p, response, options)
    const transported = await runTransport(p, [response], options)

    expect(headless.pendingApprovals?.length).toBe(1)
    expect(transported.pendingApprovals?.length).toBe(1)
    expect(expectComparable(headless)).toEqual(expectComparable(managed))
    expect(expectComparable(transported)).toEqual(expectComparable(managed))
  })

  it('matches managed generate for structured validation retry over transport', async () => {
    const model = emissionModel([])
    const p = prompt({
      id: 'ai-equivalence-validation',
      prompt: 'Return JSON.',
      output: z.object({ ok: z.boolean() }),
    })
    const invalid = objectGenerationError('{"ok":"no"}')
    const fixed = sdkResponse({ text: '{"ok":true}', object: { ok: true } })
    const options = {
      model,
      validationRetry: { maxRetries: 1 },
    } as const

    const managed = await createCruxAi({ gateway: gatewayFor('generateObject', [invalid, fixed]) }).generate(p, options)
    const transported = await runTransport(p, [invalid, fixed], options)

    expect(expectComparable(transported)).toEqual(expectComparable(managed))
    expect(transported.object).toEqual({ ok: true })
  })
})

async function runHandle(
  p: unknown,
  response: SdkLoopResultLike,
  options: unknown,
) {
  const handle = await createCruxAi({ gateway: noNetworkGateway() }).prepare!(p as never, options as never)
  return handle.finish(response)
}

async function runTransport(
  p: unknown,
  responses: readonly (SdkLoopResultLike | Error)[],
  options: Record<string, unknown>,
) {
  const queue = [...responses]
  return createCruxAi({ gateway: noNetworkGateway() }).generate(p as never, {
    ...options,
    transport: async () => next(queue),
  } as never)
}

function expectComparable(result: {
  readonly text: string
  readonly object?: unknown
  readonly usage?: unknown
  readonly steps: number
  readonly finalStep: unknown
  readonly messages: readonly { readonly role: string }[]
  readonly pendingApprovals?: readonly unknown[]
}) {
  return {
    text: result.text,
    object: result.object,
    usage: result.usage,
    steps: result.steps,
    finalStep: result.finalStep,
    roles: result.messages.map((message) => message.role),
    pendingApprovals: result.pendingApprovals?.length ?? 0,
  }
}

function gatewayFor(method: 'generateText' | 'generateObject', responses: readonly (SdkLoopResultLike | Error)[]): SdkGateway {
  const queue = [...responses]
  const invoke = async () => next(queue)
  const fail = async () => {
    throw new Error(`unexpected AI SDK gateway call outside ${method}`)
  }
  return {
    generateText: method === 'generateText' ? invoke : fail,
    generateObject: method === 'generateObject' ? invoke : fail,
    streamText: fail,
    streamObject: fail,
    embedMany: fail,
    rerank: fail,
  } as unknown as SdkGateway
}

function noNetworkGateway(): SdkGateway {
  const fail = async () => {
    throw new Error('handle/transport equivalence tests must not call the AI SDK gateway')
  }
  return {
    generateText: fail,
    generateObject: fail,
    streamText: fail,
    streamObject: fail,
    embedMany: fail,
    rerank: fail,
  } as unknown as SdkGateway
}

function next(queue: Array<SdkLoopResultLike | Error>): SdkLoopResultLike {
  const response = queue.shift()
  if (!response) throw new Error('script exhausted')
  if (response instanceof Error) throw response
  return response
}

function sdkResponse(args: {
  readonly text: string
  readonly object?: unknown
  readonly content?: SdkLoopResultLike['content']
  readonly steps?: SdkLoopResultLike['steps']
}): SdkLoopResultLike {
  const steps = args.steps ?? [
    {
      text: args.text,
      finishReason: 'stop',
      response: { id: 'ai_response_1', modelId: 'mock-ai-sdk' },
      usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
    },
  ]
  return {
    text: args.text,
    ...(args.object !== undefined ? { object: args.object } : {}),
    content: args.content ?? [],
    steps,
    finishReason: 'stop',
    usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
    totalUsage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
    response: {
      id: 'ai_response_1',
      modelId: 'mock-ai-sdk',
      messages: [{ role: 'assistant', content: [{ type: 'text', text: args.text }] }],
    },
  }
}
