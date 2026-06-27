/**
 * Tests for `executorAdapter()` — the factory for loop-owning adapters.
 *
 * Uses `fakeExecutor()` (the in-memory reference `ExecutorSpec`) so every
 * test exercises core policy — routing, validation retry, approval
 * protocol, steering — with zero SDK involvement.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { z } from 'zod'
import { executorAdapter } from '../../adapter/define-executor'
import { fakeExecutor } from '../../adapter/testing'
import { prompt as makePrompt } from '../../prompt/prompt'
import { fallback } from '../../generation/fallback'
import { ValidationExhaustedError } from '../../generation/validation-retry'
import { appendToolApprovalResponse } from '../../tool-middleware'
import { resetRuntime } from '../../runtime/runtime'
import type { Message } from '../../generation/messages'
import type { StepDirective } from '../../adapter/executor-types'

afterEach(() => {
  resetRuntime()
})

function textPrompt() {
  return makePrompt({
    id: 'exec-text',
    system: 'You are concise.',
    prompt: ({ input }) => (input as { instruction: string }).instruction,
    input: z.object({ instruction: z.string() }),
  })
}

function structuredPrompt() {
  return makePrompt({
    id: 'exec-structured',
    system: 'Return JSON.',
    prompt: ({ input }) => (input as { instruction: string }).instruction,
    input: z.object({ instruction: z.string() }),
    output: z.object({ title: z.string(), count: z.number() }),
  })
}

describe('executorAdapter — text generation', () => {
  it('resolves the prompt, maps settings, and returns the loop outcome', async () => {
    const fake = fakeExecutor({ loops: [[{ text: 'hello world' }]] })
    const executor = executorAdapter(fake.spec)(fake.client)

    const result = await executor.generate(textPrompt(), {
      model: 'fake:m-1',
      input: { instruction: 'Say hello' },
    })

    expect(result.text).toBe('hello world')
    expect(result.steps).toBe(1)
    expect(result._meta.finishReason).toBe('stop')
    expect(result.messages.at(-1)).toMatchObject({ role: 'assistant', content: 'hello world' })

    const request = fake.calls.runLoop[0]!
    expect(request.modelInfo).toEqual({ provider: 'fake', modelId: 'm-1' })
    expect(request.system).toBe('You are concise.')
    expect(request.prompt).toBe('Say hello')
    expect(request.maxSteps).toBe(10)
  })

  it('runs the tool loop and surfaces tool rounds in canonical messages', async () => {
    const lookup = vi.fn(async (args: unknown) => ({ found: (args as { q: string }).q }))
    const fake = fakeExecutor({
      loops: [[{ text: '', toolCalls: [{ name: 'lookup', args: { q: 'x' } }] }, { text: 'answer' }]],
    })
    const executor = executorAdapter(fake.spec)(fake.client)

    const result = await executor.generate(textPrompt(), {
      model: 'fake:m-1',
      input: { instruction: 'Find x' },
      tools: { lookup: { description: 'lookup', execute: lookup } },
    })

    expect(lookup).toHaveBeenCalledWith({ q: 'x' }, expect.objectContaining({ toolCallId: expect.any(String) }))
    expect(result.text).toBe('answer')
    expect(result.steps).toBe(2)
    expect(result.messages.some((m) => m.role === 'tool')).toBe(true)
  })

  it('lets a caller observer stop the loop after a step', async () => {
    const fake = fakeExecutor({
      loops: [
        [
          { text: 'step one', toolCalls: [{ name: 'noop', args: {} }] },
          { text: 'never reached', toolCalls: [{ name: 'noop', args: {} }] },
          { text: 'never reached either' },
        ],
      ],
    })
    const executor = executorAdapter(fake.spec)(fake.client)

    const directives: StepDirective[] = [{ kind: 'stop', reason: 'enough' }]
    const result = await executor.generate(textPrompt(), {
      model: 'fake:m-1',
      input: { instruction: 'go' },
      tools: { noop: { execute: async () => 'ok' } },
      observer: { onStepFinish: async () => directives.shift() ?? { kind: 'continue' } },
    })

    expect(result.steps).toBe(1)
    expect(result.text).toBe('step one')
  })
})

describe('executorAdapter — structured output + validation retry', () => {
  it('returns the parsed object on a valid first attempt', async () => {
    const fake = fakeExecutor({ structured: ['{"title":"hi","count":2}'] })
    const executor = executorAdapter(fake.spec)(fake.client)

    const result = await executor.generate(structuredPrompt(), {
      model: 'fake:m-1',
      input: { instruction: 'make json' },
    })

    expect(result.object).toEqual({ title: 'hi', count: 2 })
    expect(result.steps).toBe(1)
    expect(fake.calls.attemptStructured).toHaveLength(1)
  })

  it('retries with corrective feedback on invalid output, then succeeds', async () => {
    const onRetry = vi.fn()
    const fake = fakeExecutor({
      structured: ['{"title":"hi","count":"two"}', '{"title":"hi","count":2}'],
    })
    const executor = executorAdapter(fake.spec)(fake.client)

    const result = await executor.generate(structuredPrompt(), {
      model: 'fake:m-1',
      input: { instruction: 'make json' },
      validationRetry: { maxRetries: 2, onRetry },
    })

    expect(result.object).toEqual({ title: 'hi', count: 2 })
    expect(result.steps).toBe(2)
    expect(onRetry).toHaveBeenCalledTimes(1)

    // The retry attempt carries the failed output and corrective feedback.
    const retryRequest = fake.calls.attemptStructured[1]!
    const contents = (retryRequest.messages ?? []).map((m) => m.content)
    expect(contents.some((c) => typeof c === 'string' && c.includes('"count":"two"'))).toBe(true)
    expect(contents.some((c) => typeof c === 'string' && c.includes('Validation failed'))).toBe(true)
  })

  it('throws ValidationExhaustedError when retries run out', async () => {
    const onExhausted = vi.fn()
    const fake = fakeExecutor({
      structured: ['not json', 'still not json'],
    })
    const executor = executorAdapter(fake.spec)(fake.client)

    await expect(
      executor.generate(structuredPrompt(), {
        model: 'fake:m-1',
        input: { instruction: 'make json' },
        validationRetry: { maxRetries: 1, onExhausted },
      }),
    ).rejects.toThrow(ValidationExhaustedError)
    expect(onExhausted).toHaveBeenCalledTimes(1)
    expect(fake.calls.attemptStructured).toHaveLength(2)
  })
})

describe('executorAdapter — routing dispatch', () => {
  it('falls back to the next model when the first attempt throws a retryable error', async () => {
    const rateLimited = Object.assign(new Error('rate limited'), { status: 429 })
    const fake = fakeExecutor({
      loops: [rateLimited, [{ text: 'from backup' }]],
    })
    const executor = executorAdapter(fake.spec)(fake.client)

    const result = await executor.generate(textPrompt(), {
      model: fallback('fake:primary', 'fake:backup'),
      input: { instruction: 'go' },
    })

    expect(result.text).toBe('from backup')
    expect(fake.calls.runLoop).toHaveLength(2)
    expect(fake.calls.runLoop[0]!.modelInfo.modelId).toBe('primary')
    expect(fake.calls.runLoop[1]!.modelInfo.modelId).toBe('backup')
    expect((result._meta as { fallback?: { attempts: number } }).fallback?.attempts).toBe(2)
  })
})

describe('executorAdapter — tool approval protocol', () => {
  const dangerousTools = (execute: ReturnType<typeof vi.fn>) => ({
    dangerous: { description: 'risky', needsApproval: true, execute },
  })

  it('suspends on approval-needing tools with a minted token and request message', async () => {
    const execute = vi.fn()
    const fake = fakeExecutor({
      loops: [[{ text: 'I need approval', toolCalls: [{ name: 'dangerous', args: { target: 'db' } }] }]],
    })
    const executor = executorAdapter(fake.spec)(fake.client)

    const result = await executor.generate(textPrompt(), {
      model: 'fake:m-1',
      input: { instruction: 'do it' },
      tools: dangerousTools(execute),
    })

    expect(execute).not.toHaveBeenCalled()
    expect(result._meta.finishReason).toBe('tool_approval_required')
    expect(result.pendingApprovals).toHaveLength(1)
    const approval = result.pendingApprovals![0]!
    expect(approval.toolName).toBe('dangerous')
    expect(approval.approvalId).toBe(`approval_${approval.toolCallId}`)
    expect(approval.approvalToken.length).toBeGreaterThan(0)

    const lastMessage = result.messages.at(-1)!
    expect(
      (lastMessage.metadata as { toolApprovalRequests?: unknown[] } | undefined)?.toolApprovalRequests,
    ).toHaveLength(1)
  })

  it('resumes an approved tool call: executes it and feeds the round back to the loop', async () => {
    const execute = vi.fn(async () => 'deleted 3 rows')
    const fake = fakeExecutor({
      loops: [
        [{ text: 'I need approval', toolCalls: [{ name: 'dangerous', args: { target: 'db' } }] }],
        [{ text: 'all done' }],
      ],
    })
    const executor = executorAdapter(fake.spec)(fake.client)
    const prompt = textPrompt()
    const tools = dangerousTools(execute)

    const suspended = await executor.generate(prompt, {
      model: 'fake:m-1',
      input: { instruction: 'do it' },
      tools,
    })
    const approval = suspended.pendingApprovals![0]!

    const resumeMessages = appendToolApprovalResponse(suspended.messages, {
      approvalId: approval.approvalId,
      approved: true,
      approvalToken: approval.approvalToken,
    }) as Message[]

    const resumed = await executor.generate(prompt, {
      model: 'fake:m-1',
      input: { instruction: 'do it' },
      tools,
      messages: resumeMessages,
    })

    expect(execute).toHaveBeenCalledTimes(1)
    expect(resumed.text).toBe('all done')
    // The replayed tool round reached the second loop call.
    const secondLoopMessages = fake.calls.runLoop[1]!.messages ?? []
    expect(secondLoopMessages.some((m) => m.role === 'tool' && m.content.includes('deleted 3 rows'))).toBe(true)
  })
})

describe('executorAdapter — streaming', () => {
  it('returns the raw SDK stream plus typed completion metadata', async () => {
    const fake = fakeExecutor({ streams: [['hel', 'lo']] })
    const executor = executorAdapter(fake.spec)(fake.client)

    const handle = await executor.stream(textPrompt(), {
      model: 'fake:m-1',
      input: { instruction: 'stream it' },
    })

    expect(handle.raw).toMatchObject({ kind: 'fake-stream' })
    const meta = await handle.completion()
    expect(meta?.text).toBe('hello')
    expect(meta?.streaming?.totalChunks).toBe(2)
  })
})
