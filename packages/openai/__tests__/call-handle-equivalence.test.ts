import type OpenAI from 'openai'
import type { ChatCompletion } from 'openai/resources/chat/completions'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { prompt, tool } from '@use-crux/core'
import { createOpenAI } from '../src'

describe('OpenAI managed/headless/transport equivalence', () => {
  it('matches managed generate for plain text', async () => {
    const p = prompt({
      id: 'openai-equivalence-plain',
      prompt: ({ input }) => `Say ${input.word}.`,
      input: z.object({ word: z.string() }),
    })
    const responses = [openAICompletion({ text: 'hello' }, 1)]
    const options = { model: 'gpt-equivalence', input: { word: 'hello' } } as const

    const managed = await createOpenAI(scriptedClient(responses)).generate(p, options)
    const headless = await runHandle(p, responses, options)
    const transported = await runTransport(p, responses, options)

    expect(expectComparable(headless)).toEqual(expectComparable(managed))
    expect(expectComparable(transported)).toEqual(expectComparable(managed))
  })

  it('matches managed generate for tool loops', async () => {
    const p = prompt({
      id: 'openai-equivalence-tools',
      prompt: 'Use the echo tool.',
      tools: {
        echo: tool({
          description: 'Echo a value.',
          input: z.object({ value: z.string() }),
          execute: ({ value }) => `echo:${value}`,
        }),
      },
    })
    const responses = [
      openAICompletion(
        {
          text: '',
          toolCalls: [{ id: 'call_echo', name: 'echo', args: { value: 'hello' } }],
        },
        1,
      ),
      openAICompletion({ text: 'done' }, 2),
    ]
    const options = { model: 'gpt-equivalence', maxSteps: 3 } as const

    const managed = await createOpenAI(scriptedClient(responses)).generate(p, options)
    const headless = await runHandle(p, responses, options)
    const transported = await runTransport(p, responses, options)

    expect(expectComparable(headless)).toEqual(expectComparable(managed))
    expect(expectComparable(transported)).toEqual(expectComparable(managed))
  })

  it('matches managed generate for structured validation retry', async () => {
    const p = prompt({
      id: 'openai-equivalence-validation',
      prompt: 'Return JSON.',
      output: z.object({ ok: z.boolean() }),
    })
    const responses = [
      openAICompletion({ text: '{"ok":"no"}', parsed: { ok: 'no' } }, 1),
      openAICompletion({ text: '{"ok":true}', parsed: { ok: true } }, 2),
    ]
    const options = {
      model: 'gpt-equivalence',
      validationRetry: { maxRetries: 1 },
    } as const

    const managed = await createOpenAI(scriptedClient(responses)).generate(p, options)
    const headless = await runHandle(p, responses, options)
    const transported = await runTransport(p, responses, options)

    expect(expectComparable(headless)).toEqual(expectComparable(managed))
    expect(expectComparable(transported)).toEqual(expectComparable(managed))
    expect(headless.object).toEqual({ ok: true })
    expect(transported.object).toEqual({ ok: true })
  })

  it('matches managed generate for approval suspension', async () => {
    const p = prompt({
      id: 'openai-equivalence-approval',
      prompt: 'Use the guarded tool.',
      tools: {
        guarded: tool({
          description: 'Guarded tool.',
          input: z.object({ value: z.string().optional() }),
          execute: () => 'should-not-run',
        }),
      },
    })
    const responses = [
      openAICompletion(
        {
          text: 'approval needed',
          toolCalls: [{ id: 'call_guarded', name: 'guarded', args: {} }],
        },
        1,
      ),
    ]
    const options = {
      model: 'gpt-equivalence',
      toolApproval: { guarded: 'always' },
    } as const

    const managed = await createOpenAI(scriptedClient(responses)).generate(p, options)
    const headless = await runHandle(p, responses, options)
    const transported = await runTransport(p, responses, options)

    expect(headless.pendingApprovals?.length).toBe(1)
    expect(transported.pendingApprovals?.length).toBe(1)
    expect(expectComparable(headless)).toEqual(expectComparable(managed))
    expect(expectComparable(transported)).toEqual(expectComparable(managed))
  })
})

async function runHandle(
  p: Parameters<ReturnType<typeof createOpenAI>['generate']>[0],
  responses: readonly ChatCompletion[],
  options: Parameters<ReturnType<typeof createOpenAI>['generate']>[1],
) {
  let handle = await createOpenAI(noNetworkClient()).prepare!(p, options)
  for (let index = 0; index < responses.length; index++) {
    const outcome = await handle.step(responses[index]!)
    if (outcome.done) return outcome.result
    handle = outcome.next
  }
  throw new Error('handle did not complete after scripted responses')
}

async function runTransport(
  p: Parameters<ReturnType<typeof createOpenAI>['generate']>[0],
  responses: readonly ChatCompletion[],
  options: Parameters<ReturnType<typeof createOpenAI>['generate']>[1],
) {
  const queue = [...responses]
  return createOpenAI(noNetworkClient()).generate(p, {
    ...options,
    transport: async () => next(queue),
  })
}

function expectComparable(result: {
  readonly text: string
  readonly object?: unknown
  readonly usage?: unknown
  readonly steps: readonly unknown[]
  readonly finalStep: unknown
  readonly messages: readonly { readonly role: string }[]
  readonly pendingApprovals?: readonly unknown[]
}) {
  return {
    text: result.text,
    object: result.object,
    usage: result.usage,
    steps: result.steps.map(comparableStep),
    finalStep: comparableStep(result.finalStep),
    roles: result.messages.map((message) => message.role),
    pendingApprovals: result.pendingApprovals?.length ?? 0,
  }
}

// Request receipts stay comparable across executions except for their
// generated identifiers; equivalence still covers tokens, budget, and
// adaptations.
function comparableStep(step: unknown): unknown {
  if (typeof step !== 'object' || step === null) return step
  const record = step as { request?: { id?: string; previousRequestId?: string } }
  if (typeof record.request !== 'object' || record.request === null) return step
  const request: Record<string, unknown> = { ...record.request, id: '<request-id>' }
  if (record.request.previousRequestId !== undefined) {
    request.previousRequestId = '<previous-request-id>'
  }
  return { ...record, request }
}

function scriptedClient(responses: readonly ChatCompletion[]): OpenAI {
  const queue = [...responses]
  return {
    chat: {
      completions: {
        create: async () => next(queue),
        parse: async () => next(queue),
      },
    },
  } as unknown as OpenAI
}

function noNetworkClient(): OpenAI {
  return scriptedClient([])
}

function next(queue: ChatCompletion[]): ChatCompletion {
  const response = queue.shift()
  if (!response) throw new Error('script exhausted')
  return response
}

function openAICompletion(
  emission: {
    readonly text: string
    readonly parsed?: unknown
    readonly toolCalls?: readonly { readonly id: string; readonly name: string; readonly args: unknown }[]
  },
  sequence: number,
): ChatCompletion {
  const toolCalls = emission.toolCalls?.map((toolCall) => ({
    id: toolCall.id,
    type: 'function' as const,
    function: {
      name: toolCall.name,
      arguments: JSON.stringify(toolCall.args),
    },
  }))
  const message = {
    role: 'assistant' as const,
    content: emission.text || null,
    refusal: null,
    ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    ...(emission.parsed !== undefined ? { parsed: emission.parsed } : {}),
  }

  return {
    id: `chatcmpl_equivalence_${sequence}`,
    object: 'chat.completion',
    created: 0,
    model: 'gpt-equivalence-actual',
    choices: [
      {
        index: 0,
        message,
        finish_reason: toolCalls && toolCalls.length > 0 ? 'tool_calls' : 'stop',
        logprobs: null,
      },
    ],
    usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
  } as unknown as ChatCompletion
}
