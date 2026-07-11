import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { prompt, tool } from '@use-crux/core'
import { createAnthropic } from '../src'
import type { AnthropicParsedMessage } from '../src/response'

describe('Anthropic managed/headless equivalence', () => {
  it('matches managed generate for plain text', async () => {
    const p = prompt({
      id: 'anthropic-equivalence-plain',
      prompt: ({ input }) => `Say ${input.word}.`,
      input: z.object({ word: z.string() }),
    })
    const responses = [anthropicMessage({ text: 'hello' }, 1)]

    const managed = await createAnthropic(scriptedClient(responses)).generate(p, {
      model: 'claude-equivalence',
      input: { word: 'hello' },
    })
    const headless = await runHandle(p, responses, {
      model: 'claude-equivalence',
      input: { word: 'hello' },
    })
    const transported = await runTransport(p, responses, {
      model: 'claude-equivalence',
      input: { word: 'hello' },
    })

    expect(expectComparable(headless)).toEqual(expectComparable(managed))
    expect(expectComparable(transported)).toEqual(expectComparable(managed))
  })

  it('matches managed generate for tool loops', async () => {
    const p = prompt({
      id: 'anthropic-equivalence-tools',
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
      anthropicMessage(
        {
          text: '',
          toolCalls: [{ id: 'call_echo', name: 'echo', args: { value: 'hello' } }],
        },
        1,
      ),
      anthropicMessage({ text: 'done' }, 2),
    ]

    const managed = await createAnthropic(scriptedClient(responses)).generate(p, {
      model: 'claude-equivalence',
      maxSteps: 3,
    })
    const headless = await runHandle(p, responses, {
      model: 'claude-equivalence',
      maxSteps: 3,
    })
    const transported = await runTransport(p, responses, {
      model: 'claude-equivalence',
      maxSteps: 3,
    })

    expect(expectComparable(headless)).toEqual(expectComparable(managed))
    expect(expectComparable(transported)).toEqual(expectComparable(managed))
  })

  it('matches managed generate for structured validation retry', async () => {
    const p = prompt({
      id: 'anthropic-equivalence-validation',
      prompt: 'Return JSON.',
      output: z.object({ ok: z.boolean() }),
    })
    const responses = [
      anthropicMessage({ text: '{"ok":"no"}', parsed: { ok: 'no' } }, 1),
      anthropicMessage({ text: '{"ok":true}', parsed: { ok: true } }, 2),
    ]

    const options = {
      model: 'claude-equivalence',
      validationRetry: { maxRetries: 1 },
    } as const
    const managed = await createAnthropic(scriptedClient(responses)).generate(p, options)
    const headless = await runHandle(p, responses, options)
    const transported = await runTransport(p, responses, options)

    expect(expectComparable(headless)).toEqual(expectComparable(managed))
    expect(expectComparable(transported)).toEqual(expectComparable(managed))
    expect(headless.object).toEqual({ ok: true })
    expect(transported.object).toEqual({ ok: true })
  })

  it('matches managed generate for approval suspension', async () => {
    const p = prompt({
      id: 'anthropic-equivalence-approval',
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
      anthropicMessage(
        {
          text: 'approval needed',
          toolCalls: [{ id: 'call_guarded', name: 'guarded', args: {} }],
        },
        1,
      ),
    ]

    const options = {
      model: 'claude-equivalence',
      toolApproval: { guarded: 'always' },
    } as const
    const managed = await createAnthropic(scriptedClient(responses)).generate(p, options)
    const headless = await runHandle(p, responses, options)
    const transported = await runTransport(p, responses, options)

    expect(headless.pendingApprovals?.length).toBe(1)
    expect(transported.pendingApprovals?.length).toBe(1)
    expect(expectComparable(headless)).toEqual(expectComparable(managed))
    expect(expectComparable(transported)).toEqual(expectComparable(managed))
  })
})

async function runHandle(
  p: Parameters<ReturnType<typeof createAnthropic>['generate']>[0],
  responses: readonly AnthropicParsedMessage[],
  options: Parameters<ReturnType<typeof createAnthropic>['generate']>[1],
) {
  let handle = await createAnthropic(noNetworkClient()).prepare!(p, options)
  for (let index = 0; index < responses.length; index++) {
    const outcome = await handle.step(responses[index]!)
    if (outcome.done) return outcome.result
    handle = outcome.next
  }
  throw new Error('handle did not complete after scripted responses')
}

async function runTransport(
  p: Parameters<ReturnType<typeof createAnthropic>['generate']>[0],
  responses: readonly AnthropicParsedMessage[],
  options: Parameters<ReturnType<typeof createAnthropic>['generate']>[1],
) {
  const queue = [...responses]
  return createAnthropic(noNetworkClient()).generate(p, {
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
    steps: result.steps,
    finalStep: result.finalStep,
    roles: result.messages.map((message) => message.role),
    pendingApprovals: result.pendingApprovals?.length ?? 0,
  }
}

function scriptedClient(responses: readonly AnthropicParsedMessage[]): Anthropic {
  const queue = [...responses]
  return {
    messages: {
      create: async () => next(queue),
      parse: async () => next(queue),
      stream: () => {
        throw new Error('streaming is not used in handle equivalence tests')
      },
    },
  } as unknown as Anthropic
}

function noNetworkClient(): Anthropic {
  return scriptedClient([])
}

function next(queue: AnthropicParsedMessage[]): AnthropicParsedMessage {
  const response = queue.shift()
  if (!response) throw new Error('script exhausted')
  return response
}

function anthropicMessage(
  emission: {
    readonly text: string
    readonly parsed?: unknown
    readonly toolCalls?: readonly { readonly id: string; readonly name: string; readonly args: unknown }[]
  },
  sequence: number,
): AnthropicParsedMessage {
  const toolBlocks =
    emission.toolCalls?.map((toolCall) => ({
      type: 'tool_use' as const,
      id: toolCall.id,
      name: toolCall.name,
      input: toolInput(toolCall.args),
    })) ?? []

  return {
    id: `msg_${sequence}`,
    type: 'message',
    role: 'assistant',
    model: 'claude-equivalence-actual',
    content: [...(emission.text ? [{ type: 'text' as const, text: emission.text }] : []), ...toolBlocks],
    stop_reason: toolBlocks.length > 0 ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 2, output_tokens: 3 },
    ...(emission.parsed !== undefined ? { parsed_output: emission.parsed } : {}),
  } as AnthropicParsedMessage
}

function toolInput(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value }
}
