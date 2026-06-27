/**
 * Provider-runtime parity suite.
 *
 * The public `defineProviderRuntime()` compiler has two branches: single-turn
 * providers whose loop is owned by core, and loop-owned providers whose SDK
 * drives the loop. These tests assert that shared Crux policies stay identical
 * at that public boundary.
 */

import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { defineProviderRuntime } from '../../adapter'
import { fakeExecutor, type FakeExecutor } from '../../adapter/testing'
import { prompt as makePrompt } from '../../prompt/prompt'
import type { Message } from '../../messages'
import { guardrail as makeGuardrail } from '../../safety/guardrail'
import { appendToolApprovalResponse } from '../../tool-middleware'
import {
  createRuntimeClient,
  createSingleTurnTestRuntime,
  runtimeResponse,
  type RuntimeProviderMessage,
  type RuntimeToolCall,
} from './provider-runtime-fixtures'

const INVALID_JSON = '{"title":"hi","count":"two"}'
const VALID_JSON = '{"title":"hi","count":2}'

function structuredPrompt() {
  return makePrompt({
    id: 'provider-runtime-parity-structured',
    system: 'Return JSON.',
    prompt: ({ input }) => input.message,
    input: z.object({ message: z.string() }),
    output: z.object({ title: z.string(), count: z.number() }),
  })
}

function textPrompt() {
  return makePrompt({
    id: 'provider-runtime-parity-text',
    system: 'You are terse.',
    prompt: ({ input }) => input.message,
    input: z.object({ message: z.string() }),
  })
}

function createLoopRuntime(fake: FakeExecutor, id = 'provider-runtime-loop-owned') {
  return defineProviderRuntime({
    id,
    loop: {
      describeModel: fake.spec.describeModel,
      settings: fake.spec.mapSettings,
      bind: (client) => ({
        run: (request) => fake.spec.runLoop(client, request),
        attemptStructured: (request) => fake.spec.attemptStructured(client, request),
        stream: (request) => fake.spec.runStream(client, request),
        ...(fake.spec.replayStream ? { replayStream: fake.spec.replayStream } : {}),
      }),
    },
  }).create(fake.client)
}

describe('provider-runtime parity — validation retry', () => {
  it('sends the same corrective transcript through both runtime branches', async () => {
    const singleClient = createRuntimeClient({
      responses: [runtimeResponse(INVALID_JSON), runtimeResponse(VALID_JSON)],
    })
    const singleResult = await createSingleTurnTestRuntime()
      .create(singleClient)
      .generate(structuredPrompt(), {
        model: 'mock-model',
        input: { message: 'make json' },
        validationRetry: { maxRetries: 2 },
      })

    const fake = fakeExecutor({ structured: [INVALID_JSON, VALID_JSON] })
    const loopResult = await createLoopRuntime(fake).generate(structuredPrompt(), {
      model: 'fake:mock-model',
      input: { message: 'make json' },
      validationRetry: { maxRetries: 2 },
    })

    expect(singleResult.object).toEqual({ title: 'hi', count: 2 })
    expect(loopResult.object).toEqual(singleResult.object)

    const singleRetry = singleClient.calls[1]!.messages
    const loopRetry = fake.calls.attemptStructured[1]!.messages ?? []
    expect(lastUserText(loopRetry, 'make json')).toBe(lastProviderUserText(singleRetry, 'make json'))
    expect(lastProviderUserText(singleRetry, 'make json')).toContain('Validation failed for your previous output')
    expect(lastAssistantText(loopRetry)).toContain(INVALID_JSON)
    expect(lastProviderAssistantText(singleRetry)).toContain(INVALID_JSON)
  })
})

describe('provider-runtime parity — tool approval resume', () => {
  const toolCall: RuntimeToolCall = { id: 'tc_provider_runtime', name: 'dangerous', args: { target: 'db' } }

  function dangerousTools(execute: ReturnType<typeof vi.fn>) {
    return { dangerous: { description: 'risky', needsApproval: true, execute } }
  }

  it('suspends and resumes approved tool calls the same way in both runtime branches', async () => {
    const single = await suspendAndResumeSingle()
    const loop = await suspendAndResumeLoop()

    expect(single.execute).toHaveBeenCalledTimes(1)
    expect(loop.execute).toHaveBeenCalledTimes(1)
    expect(single.suspended._meta.finishReason).toBe('tool_approval_required')
    expect(loop.suspended._meta.finishReason).toBe('tool_approval_required')
    expect(single.resumed.text).toBe('all done')
    expect(loop.resumed.text).toBe(single.resumed.text)
    expect(loop.toolRound?.content).toBe(single.toolRound?.text)
    expect(loop.toolRound?.content).toBe('deleted 3 rows')
  })

  async function suspendAndResumeSingle() {
    const execute = vi.fn(async () => 'deleted 3 rows')
    const client = createRuntimeClient({
      responses: [runtimeResponse('need approval', { toolCalls: [toolCall] }), runtimeResponse('all done')],
    })
    const runtime = createSingleTurnTestRuntime().create(client)
    const prompt = textPrompt()
    const tools = dangerousTools(execute)
    const suspended = await runtime.generate(prompt, {
      model: 'mock-model',
      input: { message: 'do it' },
      tools,
    })
    const approval = suspended.pendingApprovals![0]!
    const resumed = await runtime.generate(prompt, {
      model: 'mock-model',
      input: { message: 'do it' },
      tools,
      messages: appendToolApprovalResponse(suspended.messages, {
        approvalId: approval.approvalId,
        approved: true,
        approvalToken: approval.approvalToken,
      }) as Message[],
    })
    const toolRound = client.calls[1]!.messages.find(
      (message) => message.role === 'tool' && message.metadata?.toolCallId === toolCall.id,
    )
    return { execute, suspended, resumed, toolRound }
  }

  async function suspendAndResumeLoop() {
    const execute = vi.fn(async () => 'deleted 3 rows')
    const fake = fakeExecutor({
      loops: [[{ text: 'need approval', toolCalls: [toolCall] }], [{ text: 'all done' }]],
    })
    const runtime = createLoopRuntime(fake)
    const prompt = textPrompt()
    const tools = dangerousTools(execute)
    const suspended = await runtime.generate(prompt, {
      model: 'fake:mock-model',
      input: { message: 'do it' },
      tools,
    })
    const approval = suspended.pendingApprovals![0]!
    const resumed = await runtime.generate(prompt, {
      model: 'fake:mock-model',
      input: { message: 'do it' },
      tools,
      messages: appendToolApprovalResponse(suspended.messages, {
        approvalId: approval.approvalId,
        approved: true,
        approvalToken: approval.approvalToken,
      }) as Message[],
    })
    const toolRound = (fake.calls.runLoop[1]!.messages ?? []).find(
      (message) => message.role === 'tool' && message.metadata?.toolCallId === toolCall.id,
    )
    return { execute, suspended, resumed, toolRound }
  }
})

describe('provider-runtime parity — streaming safety', () => {
  const chunks = ['import x from ', '@/co', 'mps/Button', ' done'] as const
  const transformed = 'import x from @/components/Button done'

  const importFixer = () =>
    makeGuardrail({
      name: 'provider-runtime-import-fixer',
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

  it('preserves completion metadata and applies stream transforms through both runtime branches', async () => {
    const singleClient = createRuntimeClient({ streamChunks: [chunks] })
    const singleHandle = await createSingleTurnTestRuntime()
      .create(singleClient)
      .stream(textPrompt(), {
        model: 'mock-model',
        input: { message: 'code' },
        guardrails: [importFixer()],
      })
    const singleText = await drainSingleTurnText(singleHandle)
    const singleMeta = await singleHandle.completion()

    const fake = fakeExecutor({ streams: [chunks] })
    const loopHandle = await createLoopRuntime(fake).stream(textPrompt(), {
      model: 'fake:mock-model',
      input: { message: 'code' },
      guardrails: [importFixer()],
    })
    const loopMeta = await loopHandle.completion()

    expect(singleText).toBe(transformed)
    expect(loopHandle.raw.text).toBe(transformed)
    expect(singleMeta?.finishReason).toBe('stop')
    expect(loopMeta?.finishReason).toBe(singleMeta?.finishReason)
    expect(singleMeta?.usage?.totalTokens).toBe(30)
    expect(loopMeta?.usage?.totalTokens).toBe(singleMeta?.usage?.totalTokens)
    expect(singleMeta?.guardrails?.applied).toContainEqual(
      expect.objectContaining({
        guard: 'provider-runtime-import-fixer',
        action: 'transform',
        original: '@/comps/Button',
      }),
    )
    expect(loopMeta?.guardrails?.applied).toContainEqual(
      expect.objectContaining({
        guard: 'provider-runtime-import-fixer',
        action: 'transform',
        original: '@/comps/Button',
      }),
    )
  })
})

function lastUserText(messages: readonly Message[], original: string) {
  return [...messages].reverse().find((message) => message.role === 'user' && message.content !== original)?.content
}

function lastProviderUserText(messages: readonly RuntimeProviderMessage[], original: string) {
  return [...messages].reverse().find((message) => message.role === 'user' && message.text !== original)?.text
}

function lastAssistantText(messages: readonly Message[]) {
  return [...messages].reverse().find((message) => message.role === 'assistant')?.content
}

function lastProviderAssistantText(messages: readonly RuntimeProviderMessage[]) {
  return [...messages].reverse().find((message) => message.role === 'assistant')?.text
}

async function drainSingleTurnText(handle: {
  readonly rawStream: AsyncIterable<unknown>
  readonly extractTextDelta: (chunk: unknown) => string | undefined
}) {
  let text = ''
  for await (const chunk of handle.rawStream) {
    text += handle.extractTextDelta(chunk) ?? ''
  }
  return text
}
