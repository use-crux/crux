/**
 * Cross-dialect parity suite — the contract that switching a prompt between
 * an `AdapterSpec` adapter (core-driven loop, e.g. @crux/openai) and an
 * `ExecutorSpec` adapter (SDK-driven loop, e.g. @crux/ai) changes NOTHING
 * observable except model behavior itself.
 *
 * Each scenario runs the same script through both factories and asserts the
 * model-facing messages and result metadata are identical. If a policy
 * change ever lands in only one dialect, this suite is what fails.
 */

import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { adapter as makeAdapter } from '../../adapter/define-adapter'
import { executorAdapter } from '../../adapter/define-executor'
import { fakeExecutor } from '../../adapter/testing'
import type { AdapterSpec } from '../../adapter/spec'
import type { AdapterResponse } from '../../adapter/types'
import { prompt as makePrompt } from '../../define'
import { appendToolApprovalResponse } from '../../tool-middleware'
import { ValidationExhaustedError } from '../../validation-retry'
import type { Message } from '../../messages'

// ─────────────────────────────────────────────────────────────────
// Scripted AdapterSpec (the core-driven dialect's fake)
// ─────────────────────────────────────────────────────────────────

interface ScriptedCall {
  text?: string
  toolCalls?: Array<{ id: string; name: string; args: unknown }>
}

function scriptedAdapterSpec(script: ScriptedCall[]) {
  const calls: Array<{ messages: Message[] }> = []
  const queue = [...script]
  const spec: AdapterSpec<{ kind: 'mock' }, { raw: true }, never> = {
    providerId: 'mock',
    async call(_client, args) {
      calls.push({ messages: args.messages })
      const scripted = queue.shift() ?? { text: 'exhausted' }
      const extracted: AdapterResponse = {
        text: scripted.text ?? '',
        toolCalls: scripted.toolCalls,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        finishReason: scripted.toolCalls?.length ? 'tool_calls' : 'stop',
        responseId: undefined,
        actualModelId: undefined,
      }
      return { raw: { raw: true }, extracted }
    },
    async stream() {
      throw new Error('not used in parity tests')
    },
    appendToolRound(messages, assistantResponse, toolResults) {
      return [
        ...messages,
        {
          role: 'assistant' as const,
          content: assistantResponse.text,
          metadata: { toolCalls: assistantResponse.toolCalls },
        },
        ...toolResults.map((tr) => ({
          role: 'tool' as const,
          content: tr.content,
          metadata: { toolCallId: tr.toolCallId, toolName: tr.name },
        })),
      ]
    },
    mapSettings(settings) {
      return { ...settings }
    },
  }
  return { spec, calls, client: { kind: 'mock' as const } }
}

// ─────────────────────────────────────────────────────────────────
// Shared prompts
// ─────────────────────────────────────────────────────────────────

function structuredPrompt() {
  return makePrompt({
    id: 'parity-structured',
    system: 'Return JSON.',
    prompt: ({ input }) => (input as { message: string }).message,
    input: z.object({ message: z.string() }),
    output: z.object({ title: z.string(), count: z.number() }),
  })
}

function textPrompt() {
  return makePrompt({
    id: 'parity-text',
    system: 'You are terse.',
    prompt: ({ input }) => (input as { message: string }).message,
    input: z.object({ message: z.string() }),
  })
}

const INVALID_JSON = '{"title":"hi","count":"two"}'
const VALID_JSON = '{"title":"hi","count":2}'

// ─────────────────────────────────────────────────────────────────
// Validation retry parity
// ─────────────────────────────────────────────────────────────────

describe('dialect parity — validation retry', () => {
  it('sends an identical corrective message in both dialects', async () => {
    // AdapterSpec dialect: invalid output, then valid.
    const native = scriptedAdapterSpec([{ text: INVALID_JSON }, { text: VALID_JSON }])
    const nativeAdapter = makeAdapter(native.spec)(native.client)
    await nativeAdapter.generate(structuredPrompt(), {
      model: 'mock-model',
      input: { message: 'make json' },
      validationRetry: { maxRetries: 2 },
    })

    // ExecutorSpec dialect: same script.
    const fake = fakeExecutor({ structured: [INVALID_JSON, VALID_JSON] })
    const executor = executorAdapter(fake.spec)(fake.client)
    await executor.generate(structuredPrompt(), {
      model: 'fake:mock-model',
      input: { message: 'make json' },
      validationRetry: { maxRetries: 2 },
    })

    // Both made exactly one retry call; extract the corrective exchange
    // each dialect sent to the model on that retry.
    const nativeRetryMessages = native.calls[1]!.messages
    const executorRetryMessages = fake.calls.attemptStructured[1]!.messages ?? []

    const lastUser = (messages: readonly Message[]) =>
      [...messages].reverse().find((m) => m.role === 'user' && m.content !== 'make json')?.content
    const assistantEcho = (messages: readonly Message[]) =>
      [...messages].reverse().find((m) => m.role === 'assistant')?.content

    // The corrective user message is byte-identical across dialects.
    expect(lastUser(executorRetryMessages)).toBe(lastUser(nativeRetryMessages))
    expect(lastUser(nativeRetryMessages)).toContain('Validation failed for your previous output')
    expect(lastUser(nativeRetryMessages)).toContain('at "count"')
    // Both echo the failed output back as the assistant turn.
    expect(assistantEcho(executorRetryMessages)).toContain(INVALID_JSON)
    expect(assistantEcho(nativeRetryMessages)).toContain(INVALID_JSON)
  })

  it('exhausts with the same error type and diagnostics in both dialects', async () => {
    const native = scriptedAdapterSpec([{ text: 'not json' }, { text: 'still not json' }])
    const nativeAdapter = makeAdapter(native.spec)(native.client)
    const nativeError = await nativeAdapter
      .generate(structuredPrompt(), {
        model: 'mock-model',
        input: { message: 'make json' },
        validationRetry: { maxRetries: 1 },
      })
      .then(() => undefined)
      .catch((error: unknown) => error)

    const fake = fakeExecutor({ structured: ['not json', 'still not json'] })
    const executor = executorAdapter(fake.spec)(fake.client)
    const executorError = await executor
      .generate(structuredPrompt(), {
        model: 'fake:mock-model',
        input: { message: 'make json' },
        validationRetry: { maxRetries: 1 },
      })
      .then(() => undefined)
      .catch((error: unknown) => error)

    expect(nativeError).toBeInstanceOf(ValidationExhaustedError)
    expect(executorError).toBeInstanceOf(ValidationExhaustedError)
    const nativeExhausted = nativeError as ValidationExhaustedError
    const executorExhausted = executorError as ValidationExhaustedError
    expect(executorExhausted.attempts).toBe(nativeExhausted.attempts)
    expect(executorExhausted.maxAttempts).toBe(nativeExhausted.maxAttempts)
    expect(executorExhausted.promptId).toBe(nativeExhausted.promptId)
  })
})

// ─────────────────────────────────────────────────────────────────
// Tool approval parity
// ─────────────────────────────────────────────────────────────────

describe('dialect parity — tool approval protocol', () => {
  const toolCall = { id: 'tc_parity', name: 'dangerous', args: { target: 'db' } }

  function dangerousTools(execute: ReturnType<typeof vi.fn>) {
    return { dangerous: { description: 'risky', needsApproval: true, execute } }
  }

  it('suspends with the same finish reason and approval-request message shape', async () => {
    const nativeExecute = vi.fn()
    const native = scriptedAdapterSpec([{ text: 'need approval', toolCalls: [toolCall] }])
    const nativeAdapter = makeAdapter(native.spec)(native.client)
    const nativeResult = await nativeAdapter.generate(textPrompt(), {
      model: 'mock-model',
      input: { message: 'do it' },
      tools: dangerousTools(nativeExecute),
    })

    const executorExecute = vi.fn()
    const fake = fakeExecutor({ loops: [[{ text: 'need approval', toolCalls: [toolCall] }]] })
    const executor = executorAdapter(fake.spec)(fake.client)
    const executorResult = await executor.generate(textPrompt(), {
      model: 'fake:mock-model',
      input: { message: 'do it' },
      tools: dangerousTools(executorExecute),
    })

    // Neither dialect executed the tool.
    expect(nativeExecute).not.toHaveBeenCalled()
    expect(executorExecute).not.toHaveBeenCalled()
    expect(nativeResult._meta.finishReason).toBe('tool_approval_required')
    expect(executorResult._meta.finishReason).toBe('tool_approval_required')

    // The persisted approval-request message has the identical structure
    // (same keys, same derived approvalId) modulo the random token.
    type RequestMeta = { toolApprovalRequests: Array<Record<string, unknown>> }
    const nativeRequest = (nativeResult.messages.at(-1)!.metadata as RequestMeta).toolApprovalRequests[0]!
    const executorRequest = (executorResult.messages.at(-1)!.metadata as RequestMeta).toolApprovalRequests[0]!

    expect(Object.keys(executorRequest).sort()).toEqual(Object.keys(nativeRequest).sort())
    expect(executorRequest.approvalId).toBe(nativeRequest.approvalId)
    expect(executorRequest.toolCallId).toBe(nativeRequest.toolCallId)
    expect(executorRequest.toolName).toBe(nativeRequest.toolName)
    expect(executorRequest.input).toEqual(nativeRequest.input)
  })

  it('resumes an approved call identically: tool executes once, same tool round content', async () => {
    async function suspendAndResume(kind: 'native' | 'executor') {
      const execute = vi.fn(async () => 'deleted 3 rows')
      const prompt = textPrompt()
      const tools = dangerousTools(execute)

      if (kind === 'native') {
        const first = scriptedAdapterSpec([{ text: 'need approval', toolCalls: [toolCall] }])
        const suspended = await makeAdapter(first.spec)(first.client).generate(prompt, {
          model: 'mock-model',
          input: { message: 'do it' },
          tools,
        })
        const request = (suspended.messages.at(-1)!.metadata as { toolApprovalRequests: Array<{ approvalId: string; approvalToken: string }> })
          .toolApprovalRequests[0]!
        const second = scriptedAdapterSpec([{ text: 'all done' }])
        const resumed = await makeAdapter(second.spec)(second.client).generate(prompt, {
          model: 'mock-model',
          input: { message: 'do it' },
          tools,
          messages: appendToolApprovalResponse(suspended.messages, {
            approvalId: request.approvalId,
            approved: true,
            approvalToken: request.approvalToken,
          }) as Message[],
        })
        const toolRound = second.calls[0]!.messages.find((m) => m.role === 'tool' && m.metadata?.toolCallId === toolCall.id)
        return { execute, text: resumed.text, toolRound }
      }

      const first = fakeExecutor({ loops: [[{ text: 'need approval', toolCalls: [toolCall] }]] })
      const suspended = await executorAdapter(first.spec)(first.client).generate(prompt, {
        model: 'fake:mock-model',
        input: { message: 'do it' },
        tools,
      })
      const approval = suspended.pendingApprovals![0]!
      const second = fakeExecutor({ loops: [[{ text: 'all done' }]] })
      const resumed = await executorAdapter(second.spec)(second.client).generate(prompt, {
        model: 'fake:mock-model',
        input: { message: 'do it' },
        tools,
        messages: appendToolApprovalResponse(suspended.messages, {
          approvalId: approval.approvalId,
          approved: true,
          approvalToken: approval.approvalToken,
        }) as Message[],
      })
      const toolRound = (second.calls.runLoop[0]!.messages ?? []).find((m) => m.role === 'tool' && m.metadata?.toolCallId === toolCall.id)
      return { execute, text: resumed.text, toolRound }
    }

    const native = await suspendAndResume('native')
    const viaExecutor = await suspendAndResume('executor')

    expect(native.execute).toHaveBeenCalledTimes(1)
    expect(viaExecutor.execute).toHaveBeenCalledTimes(1)
    expect(native.text).toBe('all done')
    expect(viaExecutor.text).toBe('all done')
    // The replayed tool result the model sees is identical.
    expect(viaExecutor.toolRound?.content).toBe(native.toolRound?.content)
    expect(viaExecutor.toolRound?.content).toBe('deleted 3 rows')
  })
})

// ─────────────────────────────────────────────────────────────────
// Step budget parity
// ─────────────────────────────────────────────────────────────────

describe('dialect parity — default step budget', () => {
  it('both factories default to the same maxSteps and cap the loop identically', async () => {
    const execute = vi.fn(async () => 'ok')
    const tools = { noop: { description: 'noop', execute } }
    const endlessToolCall = (i: number): ScriptedCall => ({
      text: '',
      toolCalls: [{ id: `tc_${i}`, name: 'noop', args: {} }],
    })
    const script = Array.from({ length: 15 }, (_, i) => endlessToolCall(i))

    const native = scriptedAdapterSpec(script)
    const nativeResult = await makeAdapter(native.spec)(native.client).generate(textPrompt(), {
      model: 'mock-model',
      input: { message: 'loop' },
      tools,
    })

    const fake = fakeExecutor({ loops: [script.map((s) => ({ text: s.text, toolCalls: s.toolCalls }))] })
    const executorResult = await executorAdapter(fake.spec)(fake.client).generate(textPrompt(), {
      model: 'fake:mock-model',
      input: { message: 'loop' },
      tools,
    })

    expect(nativeResult.steps).toBe(10)
    expect(executorResult.steps).toBe(10)
  })
})
