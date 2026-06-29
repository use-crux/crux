/**
 * Cross-dialect parity suite — the contract that switching a prompt between
 * an `AdapterSpec` adapter (core-driven loop, e.g. @use-crux/openai) and an
 * `LoopRuntimePort` adapter (SDK-driven loop, e.g. @use-crux/ai) changes NOTHING
 * observable except model behavior itself.
 *
 * Each scenario runs the same script through both factories and asserts the
 * model-facing messages and result metadata are identical. If a policy
 * change ever lands in only one dialect, this suite is what fails.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { z } from 'zod'
import { adapter as makeAdapter } from '../../adapter/define-adapter'
import { loopRuntimeAdapter } from '../../adapter/define-executor'
import { fakeLoopRuntime } from '../../adapter/testing'
import type { AdapterSpec } from '../../adapter/spec'
import type { AdapterResponse } from '../../adapter/types'
import { prompt as makePrompt } from '../../prompt/prompt'
import { guardrail as makeGuardrail, GuardrailBlockedError } from '../../safety/guardrail'
import { constraint as makeConstraint } from '../../safety/constraint'
import { ConstraintViolationError } from '../../safety/constraint/errors'
import { toolMiddleware } from '../../tools/middleware'
import { appendToolApprovalResponse } from '../../tools/approvals'
import { skill } from '../../skill'
import { LOAD_SKILL_TOOL_NAME } from '../../skill/tools'
import { ValidationExhaustedError } from '../../generation/validation-retry'
import { updateRuntime, resetRuntime } from '../../runtime/runtime'
import type { Message } from '../../generation/messages'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
  type CruxGraphRecord,
} from '../../observability'

afterEach(() => {
  resetRuntime()
  resetObservabilityRuntime()
})

// ─────────────────────────────────────────────────────────────────
// Scripted AdapterSpec (the core-driven dialect's fake)
// ─────────────────────────────────────────────────────────────────

interface ScriptedCall {
  text?: string
  toolCalls?: Array<{ id: string; name: string; args: unknown }>
}

function scriptedAdapterSpec(script: ScriptedCall[]) {
  const calls: Array<{ messages: Message[]; system: string | undefined }> = []
  const queue = [...script]
  const spec: AdapterSpec<{ kind: 'mock' }, { raw: true }, never> = {
    providerId: 'mock',
    async call(_client, args) {
      calls.push({ messages: args.messages, system: args.system })
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

    // LoopRuntimePort dialect: same script.
    const fake = fakeLoopRuntime({ structured: [INVALID_JSON, VALID_JSON] })
    const executor = loopRuntimeAdapter(fake.runtime)
    await executor.generate(structuredPrompt(), {
      model: 'fake:mock-model',
      input: { message: 'make json' },
      validationRetry: { maxRetries: 2 },
    })

    // Both made exactly one retry call; extract the corrective exchange
    // each dialect sent to the model on that retry.
    const nativeRetryMessages = native.calls[1]!.messages
    const executorRetryMessages = fake.calls.runStructuredAttempt[1]!.messages ?? []

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

    const fake = fakeLoopRuntime({ structured: ['not json', 'still not json'] })
    const executor = loopRuntimeAdapter(fake.runtime)
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
    const fake = fakeLoopRuntime({ loops: [[{ text: 'need approval', toolCalls: [toolCall] }]] })
    const executor = loopRuntimeAdapter(fake.runtime)
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
        const request = (
          suspended.messages.at(-1)!.metadata as {
            toolApprovalRequests: Array<{ approvalId: string; approvalToken: string }>
          }
        ).toolApprovalRequests[0]!
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
        const toolRound = second.calls[0]!.messages.find(
          (m) => m.role === 'tool' && m.metadata?.toolCallId === toolCall.id,
        )
        return { execute, text: resumed.text, toolRound }
      }

      const first = fakeLoopRuntime({ loops: [[{ text: 'need approval', toolCalls: [toolCall] }]] })
      const suspended = await loopRuntimeAdapter(first.runtime).generate(prompt, {
        model: 'fake:mock-model',
        input: { message: 'do it' },
        tools,
      })
      const approval = suspended.pendingApprovals![0]!
      const second = fakeLoopRuntime({ loops: [[{ text: 'all done' }]] })
      const resumed = await loopRuntimeAdapter(second.runtime).generate(prompt, {
        model: 'fake:mock-model',
        input: { message: 'do it' },
        tools,
        messages: appendToolApprovalResponse(suspended.messages, {
          approvalId: approval.approvalId,
          approved: true,
          approvalToken: approval.approvalToken,
        }) as Message[],
      })
      const toolRound = (second.calls.runTextLoop[0]!.messages ?? []).find(
        (m) => m.role === 'tool' && m.metadata?.toolCallId === toolCall.id,
      )
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
// Input guardrail parity
// ─────────────────────────────────────────────────────────────────

describe('dialect parity — input guardrail redaction', () => {
  const SECRET = 'sk-12345'

  const redactor = () =>
    makeGuardrail({
      name: 'secret-redactor',
      phase: 'input',
      validate: async (content) => {
        if (!content.includes(SECRET)) return { action: 'pass' as const }
        return { action: 'redact' as const, content: content.replaceAll(SECRET, '[REDACTED]') }
      },
    })

  it('sends the redacted user message to the provider in both dialects', async () => {
    const userText = `my api key is ${SECRET}, please summarize`

    // AdapterSpec dialect: the prompt is rendered into the user message.
    const native = scriptedAdapterSpec([{ text: 'ok' }])
    await makeAdapter(native.spec)(native.client).generate(textPrompt(), {
      model: 'mock-model',
      input: { message: userText },
      guardrails: [redactor()],
    })
    const nativeUser = native.calls[0]!.messages.find((m) => m.role === 'user')
    expect(nativeUser?.content).toBe('my api key is [REDACTED], please summarize')

    // LoopRuntimePort dialect: explicit message history.
    const fake = fakeLoopRuntime({ loops: [[{ text: 'ok' }]] })
    await loopRuntimeAdapter(fake.runtime).generate(textPrompt(), {
      model: 'fake:mock-model',
      input: { message: userText },
      messages: [{ role: 'user', content: userText }],
      guardrails: [redactor()],
    })
    const executorUser = [...(fake.calls.runTextLoop[0]!.messages ?? [])].reverse().find((m) => m.role === 'user')
    expect(executorUser?.content).toBe('my api key is [REDACTED], please summarize')
    expect(executorUser?.content).toBe(nativeUser?.content)
  })

  it('redacts the prompt-text fallback in the executor dialect', async () => {
    // No message history: the executor dialect guards the rendered prompt
    // text and must forward the redacted text to the provider.
    const fake = fakeLoopRuntime({ loops: [[{ text: 'ok' }]] })
    await loopRuntimeAdapter(fake.runtime).generate(textPrompt(), {
      model: 'fake:mock-model',
      input: { message: `key: ${SECRET}` },
      guardrails: [redactor()],
    })
    expect(fake.calls.runTextLoop[0]!.prompt).toBe('key: [REDACTED]')
  })
})

// ─────────────────────────────────────────────────────────────────
// Safety protocol parity — constraints, output guards, suspension
// ─────────────────────────────────────────────────────────────────

/**
 * Record the safety protocol as the ordered sequence of instrumentation
 * hook events. Both dialects construct the same `Safety` session, so for
 * the same inputs they must produce identical sequences.
 */
function recordSafetyProtocol() {
  const events: Array<Record<string, unknown>> = []
  updateRuntime({
    instrumentationHooks: {
      onGuardrailRun: (event) =>
        events.push({ t: 'guardrail', id: event.guardrailId, phase: event.phase, action: event.action }),
      onConstraintCheck: (event) => events.push({ t: 'check', name: event.constraintName, pass: event.pass }),
      onConstraintRetry: (event) => events.push({ t: 'retry', names: event.constraintNames, attempt: event.attempt }),
      onConstraintViolation: (event) =>
        events.push({ t: 'violation', names: event.constraintNames, attempts: event.totalAttempts }),
    },
  })
  return events
}

const needsShip = () =>
  makeConstraint({
    name: 'mentions-ship',
    maxRetries: 2,
    check: async (output) =>
      output.text.includes('ship') ? { pass: true as const } : { pass: false as const, feedback: 'must mention ship' },
  })

describe('dialect parity — constraint retry protocol', () => {
  it('retry-then-accept: identical corrective message, hook sequence, and audit in both dialects', async () => {
    // AdapterSpec dialect: wrong output, then fixed output.
    const nativeEvents = recordSafetyProtocol()
    const native = scriptedAdapterSpec([{ text: 'no boats' }, { text: 'a ship!' }])
    const nativeResult = await makeAdapter(native.spec)(native.client).generate(textPrompt(), {
      model: 'mock-model',
      input: { message: 'write' },
      constraints: [needsShip()],
    })
    const nativeProtocol = [...nativeEvents]
    resetRuntime()

    // LoopRuntimePort dialect: same script.
    const executorEvents = recordSafetyProtocol()
    const fake = fakeLoopRuntime({ loops: [[{ text: 'no boats' }], [{ text: 'a ship!' }]] })
    const executorResult = await loopRuntimeAdapter(fake.runtime).generate(textPrompt(), {
      model: 'fake:mock-model',
      input: { message: 'write' },
      constraints: [needsShip()],
    })
    const executorProtocol = [...executorEvents]

    // Same final text, same audit, same protocol sequence.
    expect(nativeResult.text).toBe('a ship!')
    expect(executorResult.text).toBe('a ship!')
    expect(executorProtocol).toEqual(nativeProtocol)
    expect(nativeProtocol).toEqual([
      { t: 'check', name: 'mentions-ship', pass: false },
      { t: 'retry', names: ['mentions-ship'], attempt: 1 },
      { t: 'check', name: 'mentions-ship', pass: true },
    ])
    expect(executorResult._meta.constraints?.entries.map((e) => e.pass)).toEqual(
      nativeResult._meta.constraints?.entries.map((e) => e.pass),
    )

    // The corrective user message each dialect sent the model is identical.
    const lastUser = (messages: readonly Message[] | undefined) =>
      [...(messages ?? [])].reverse().find((m) => m.role === 'user' && m.content !== 'write')?.content
    const nativeCorrective = lastUser(native.calls[1]!.messages)
    const executorCorrective = lastUser(fake.calls.runTextLoop[1]!.messages)
    expect(executorCorrective).toBe(nativeCorrective)
    expect(nativeCorrective).toContain('did not satisfy the following quality constraints')
    expect(nativeCorrective).toContain('[mentions-ship]: must mention ship')
  })

  it('exhaustion: identical error type and violation hook in both dialects', async () => {
    const nativeEvents = recordSafetyProtocol()
    const native = scriptedAdapterSpec([{ text: 'wrong' }, { text: 'wrong' }, { text: 'wrong' }])
    const nativeError = await makeAdapter(native.spec)(native.client)
      .generate(textPrompt(), {
        model: 'mock-model',
        input: { message: 'write' },
        constraints: [needsShip()],
        constraintMaxRetries: 1,
      })
      .then(() => undefined)
      .catch((error: unknown) => error)
    const nativeProtocol = [...nativeEvents]
    resetRuntime()

    const executorEvents = recordSafetyProtocol()
    const fake = fakeLoopRuntime({ loops: [[{ text: 'wrong' }], [{ text: 'wrong' }], [{ text: 'wrong' }]] })
    const executorError = await loopRuntimeAdapter(fake.runtime)
      .generate(textPrompt(), {
        model: 'fake:mock-model',
        input: { message: 'write' },
        constraints: [needsShip()],
        constraintMaxRetries: 1,
      })
      .then(() => undefined)
      .catch((error: unknown) => error)

    expect(nativeError).toBeInstanceOf(ConstraintViolationError)
    expect(executorError).toBeInstanceOf(ConstraintViolationError)
    expect((executorError as ConstraintViolationError).totalAttempts).toBe(
      (nativeError as ConstraintViolationError).totalAttempts,
    )
    expect(executorEvents).toEqual(nativeProtocol)
    expect(nativeProtocol.at(-1)).toEqual({ t: 'violation', names: ['mentions-ship'], attempts: 2 })
  })
})

describe('dialect parity — clean pass and blocks', () => {
  it('clean pass: identical protocol sequence and audits when everything passes', async () => {
    const passGuard = () =>
      makeGuardrail({ name: 'g-in', phase: 'input', validate: async () => ({ action: 'pass' as const }) })
    const passConstraint = () => makeConstraint({ name: 'c-pass', check: async () => ({ pass: true as const }) })

    const nativeEvents = recordSafetyProtocol()
    const native = scriptedAdapterSpec([{ text: 'a ship!' }])
    const nativeResult = await makeAdapter(native.spec)(native.client).generate(textPrompt(), {
      model: 'mock-model',
      input: { message: 'write' },
      guardrails: [passGuard()],
      constraints: [passConstraint()],
    })
    const nativeProtocol = [...nativeEvents]
    resetRuntime()

    const executorEvents = recordSafetyProtocol()
    const fake = fakeLoopRuntime({ loops: [[{ text: 'a ship!' }]] })
    const executorResult = await loopRuntimeAdapter(fake.runtime).generate(textPrompt(), {
      model: 'fake:mock-model',
      input: { message: 'write' },
      guardrails: [passGuard()],
      constraints: [passConstraint()],
    })

    expect(executorEvents).toEqual(nativeProtocol)
    expect(nativeProtocol).toEqual([
      { t: 'guardrail', id: 'g-in', phase: 'input', action: 'pass' },
      { t: 'check', name: 'c-pass', pass: true },
    ])
    expect(executorResult.text).toBe(nativeResult.text)
    expect(executorResult._meta.constraints?.allPassed).toBe(true)
    expect(nativeResult._meta.constraints?.allPassed).toBe(true)
  })

  it('input block: both dialects throw GuardrailBlockedError before any provider call', async () => {
    const blocker = () =>
      makeGuardrail({
        name: 'input-blocker',
        phase: 'input',
        validate: async () => ({ action: 'block' as const, reason: 'unsafe input' }),
      })

    const native = scriptedAdapterSpec([{ text: 'never reached' }])
    const nativeError = await makeAdapter(native.spec)(native.client)
      .generate(textPrompt(), { model: 'mock-model', input: { message: 'bad' }, guardrails: [blocker()] })
      .then(() => undefined)
      .catch((error: unknown) => error)

    const fake = fakeLoopRuntime({ loops: [[{ text: 'never reached' }]] })
    const executorError = await loopRuntimeAdapter(fake.runtime)
      .generate(textPrompt(), { model: 'fake:mock-model', input: { message: 'bad' }, guardrails: [blocker()] })
      .then(() => undefined)
      .catch((error: unknown) => error)

    expect(nativeError).toBeInstanceOf(GuardrailBlockedError)
    expect(executorError).toBeInstanceOf(GuardrailBlockedError)
    expect((executorError as GuardrailBlockedError).phase).toBe('input')
    expect((executorError as GuardrailBlockedError).guardrailId).toBe(
      (nativeError as GuardrailBlockedError).guardrailId,
    )
    // The provider was never called in either dialect.
    expect(native.calls).toHaveLength(0)
    expect(fake.calls.runTextLoop).toHaveLength(0)
  })

  it('output block: both dialects throw GuardrailBlockedError with the same identity', async () => {
    const blocker = () =>
      makeGuardrail({
        name: 'output-blocker',
        phase: 'output',
        validate: async () => ({ action: 'block' as const, reason: 'unsafe output' }),
      })

    const native = scriptedAdapterSpec([{ text: 'toxic output' }])
    const nativeError = await makeAdapter(native.spec)(native.client)
      .generate(textPrompt(), { model: 'mock-model', input: { message: 'go' }, guardrails: [blocker()] })
      .then(() => undefined)
      .catch((error: unknown) => error)

    const fake = fakeLoopRuntime({ loops: [[{ text: 'toxic output' }]] })
    const executorError = await loopRuntimeAdapter(fake.runtime)
      .generate(textPrompt(), { model: 'fake:mock-model', input: { message: 'go' }, guardrails: [blocker()] })
      .then(() => undefined)
      .catch((error: unknown) => error)

    expect(nativeError).toBeInstanceOf(GuardrailBlockedError)
    expect(executorError).toBeInstanceOf(GuardrailBlockedError)
    expect((executorError as GuardrailBlockedError).phase).toBe('output')
    expect((executorError as GuardrailBlockedError).reason).toBe((nativeError as GuardrailBlockedError).reason)
  })
})

describe('dialect parity — output guards and suspension', () => {
  const outputRedactor = () =>
    makeGuardrail({
      name: 'email-redactor',
      phase: 'output',
      validate: async (content) =>
        content.includes('a@b.c')
          ? { action: 'redact' as const, content: content.replaceAll('a@b.c', '[EMAIL]') }
          : { action: 'pass' as const },
    })

  it('output guards redact the final text identically and stamp the same audit shape', async () => {
    const native = scriptedAdapterSpec([{ text: 'mail a@b.c now' }])
    const nativeResult = await makeAdapter(native.spec)(native.client).generate(textPrompt(), {
      model: 'mock-model',
      input: { message: 'write' },
      guardrails: [outputRedactor()],
    })

    const fake = fakeLoopRuntime({ loops: [[{ text: 'mail a@b.c now' }]] })
    const executorResult = await loopRuntimeAdapter(fake.runtime).generate(textPrompt(), {
      model: 'fake:mock-model',
      input: { message: 'write' },
      guardrails: [outputRedactor()],
    })

    expect(nativeResult.text).toBe('mail [EMAIL] now')
    expect(executorResult.text).toBe(nativeResult.text)
    const strip = (entries: ReadonlyArray<Record<string, unknown>> | undefined) =>
      entries?.map(({ durationMs: _durationMs, ...rest }) => rest)
    expect(strip(executorResult._meta.guardrails?.applied)).toEqual(strip(nativeResult._meta.guardrails?.applied))
  })

  it('tool-approval suspension skips output safety in BOTH dialects', async () => {
    const guardSpy = vi.fn()
    const spyGuard = () =>
      makeGuardrail({
        name: 'spy',
        phase: 'output',
        validate: async () => {
          guardSpy()
          return { action: 'pass' as const }
        },
      })
    const checkSpy = vi.fn()
    const spyConstraint = () =>
      makeConstraint({
        name: 'spy-c',
        check: async () => {
          checkSpy()
          return { pass: true as const }
        },
      })
    const toolCall = { id: 'tc_s', name: 'dangerous', args: {} }
    const tools = { dangerous: { description: 'risky', needsApproval: true, execute: vi.fn() } }

    const native = scriptedAdapterSpec([{ text: 'need approval', toolCalls: [toolCall] }])
    const nativeResult = await makeAdapter(native.spec)(native.client).generate(textPrompt(), {
      model: 'mock-model',
      input: { message: 'go' },
      tools,
      guardrails: [spyGuard()],
      constraints: [spyConstraint()],
    })

    const fake = fakeLoopRuntime({ loops: [[{ text: 'need approval', toolCalls: [toolCall] }]] })
    const executorResult = await loopRuntimeAdapter(fake.runtime).generate(textPrompt(), {
      model: 'fake:mock-model',
      input: { message: 'go' },
      tools,
      guardrails: [spyGuard()],
      constraints: [spyConstraint()],
    })

    expect(nativeResult._meta.finishReason).toBe('tool_approval_required')
    expect(executorResult._meta.finishReason).toBe('tool_approval_required')
    // The suspension policy is decided once, in the session: no output
    // guard and no constraint ran in either dialect.
    expect(guardSpy).not.toHaveBeenCalled()
    expect(checkSpy).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────
// Streaming safety parity — holds and transforms reach stream output
// ─────────────────────────────────────────────────────────────────

describe('dialect parity — streamed run with holds and transforms', () => {
  const importFixer = () =>
    makeGuardrail({
      name: 'import-fixer',
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

  it('executor dialect: the spec drives the safety stream — holds buffer, transforms reach the consumer', async () => {
    const fake = fakeLoopRuntime({ streams: [['import x from ', '@/co', 'mps/Button', ' — done']] })
    const handle = await loopRuntimeAdapter(fake.runtime).stream(textPrompt(), {
      model: 'fake:mock-model',
      input: { message: 'code' },
      guardrails: [importFixer()],
    })

    expect(handle.raw.text).toBe('import x from @/components/Button — done')
    const meta = await handle.completion()
    expect(meta?.text).toBe('import x from @/components/Button — done')
    // The mid-stream fix landed in the audit with the original content.
    expect(meta?.guardrails?.applied).toContainEqual(
      expect.objectContaining({ guard: 'import-fixer', action: 'transform', original: '@/comps/Button' }),
    )
  })

  it('adapter dialect: stream() drives the same protocol over text deltas', async () => {
    const chunks = ['import x from ', '@/co', 'mps/Button', ' — done']
    const spec: AdapterSpec<{ kind: 'mock' }, { raw: true }, AsyncIterable<{ text: string }>> = {
      providerId: 'mock',
      async call() {
        throw new Error('not used')
      },
      async stream() {
        async function* rawStream() {
          for (const text of chunks) yield { text }
        }
        return {
          rawStream: rawStream(),
          extractTextDelta: (chunk: unknown) => (chunk as { text?: string }).text,
          completion: async () => ({ finishReason: 'stop' }),
        }
      },
      appendToolRound(messages) {
        return [...messages]
      },
      mapSettings(settings) {
        return { ...settings }
      },
    }

    const handle = await makeAdapter(spec)({ kind: 'mock' }).stream(textPrompt(), {
      model: 'mock-model',
      input: { message: 'code' },
      guardrails: [importFixer()],
    })

    let streamed = ''
    for await (const chunk of handle.rawStream) {
      streamed += handle.extractTextDelta(chunk) ?? ''
    }
    expect(streamed).toBe('import x from @/components/Button — done')

    const meta = await handle.completion()
    expect(meta?.guardrails?.applied).toContainEqual(
      expect.objectContaining({ guard: 'import-fixer', action: 'transform', original: '@/comps/Button' }),
    )
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

    const fake = fakeLoopRuntime({ loops: [script.map((s) => ({ text: s.text, toolCalls: s.toolCalls }))] })
    const executorResult = await loopRuntimeAdapter(fake.runtime).generate(textPrompt(), {
      model: 'fake:mock-model',
      input: { message: 'loop' },
      tools,
    })

    expect(nativeResult.steps).toBe(10)
    expect(executorResult.steps).toBe(10)
  })
})

// ─────────────────────────────────────────────────────────────────
// Tool protocol parity — the ToolLifecycle session drives both dialects
// ─────────────────────────────────────────────────────────────────

/**
 * Record the tool protocol as the ordered sequence of instrumentation hook
 * events, projected to the fields both regime emission profiles share
 * (timings, span ids, and trace ids are profile-specific by design).
 */
function recordToolProtocol() {
  const events: Array<Record<string, unknown>> = []
  updateRuntime({
    instrumentationHooks: {
      onToolStart: (event) =>
        events.push({ t: 'start', toolCallId: event.toolCallId, toolName: event.toolName, args: event.args }),
      onToolEnd: (event) =>
        events.push({
          t: 'end',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: event.result,
          modelOutputType: event.modelOutputType,
          error: event.error,
        }),
      onToolApprovalRequest: (event) =>
        events.push({
          t: 'approval.request',
          approvalId: event.approvalId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
        }),
    },
  })
  return events
}

type ProjectedToolEmission =
  | {
      readonly t: 'span:start'
      readonly primitive: 'tool.call'
      readonly name: string
      readonly attributes: Record<string, unknown>
    }
  | {
      readonly t: 'artifact'
      readonly kind: 'tool.args' | 'tool.result'
      readonly preview: unknown
      readonly attributes: Record<string, unknown>
    }
  | {
      readonly t: 'edge'
      readonly edgeType: 'consumed' | 'produced'
      readonly from: 'artifact' | 'span'
      readonly to: 'artifact' | 'span'
    }

const TOOL_ATTRIBUTE_KEYS = [
  'toolCallId',
  'toolName',
  'inputSize',
  'resultKind',
  'outputSize',
  'modelOutputType',
  'modelOutputSize',
  'tokenSavingsEstimate',
  'isError',
] as const

function projectToolAttributes(attributes: Record<string, unknown> | undefined): Record<string, unknown> {
  const projected: Record<string, unknown> = {}
  for (const key of TOOL_ATTRIBUTE_KEYS) {
    if (attributes?.[key] !== undefined) projected[key] = attributes[key]
  }
  return projected
}

function projectToolEmission(
  records: readonly CruxGraphRecord[],
  toolCallId: string,
): readonly ProjectedToolEmission[] {
  const toolSpanIds = new Set<string>()
  const toolArtifactIds = new Set<string>()
  const projected: ProjectedToolEmission[] = []

  for (const record of records) {
    if (
      record.type === 'span:start' &&
      record.primitive === 'tool.call' &&
      record.attributes?.toolCallId === toolCallId
    ) {
      toolSpanIds.add(record.spanId)
      projected.push({
        t: 'span:start',
        primitive: 'tool.call',
        name: record.name,
        attributes: projectToolAttributes(record.attributes),
      })
    }

    if (
      record.type === 'artifact' &&
      (record.kind === 'tool.args' || record.kind === 'tool.result') &&
      record.attributes?.toolCallId === toolCallId
    ) {
      toolArtifactIds.add(record.artifactId)
      projected.push({
        t: 'artifact',
        kind: record.kind,
        preview: record.preview,
        attributes: projectToolAttributes(record.attributes),
      })
    }
  }

  for (const record of records) {
    if (record.type !== 'edge') continue
    if (record.edgeType !== 'consumed' && record.edgeType !== 'produced') continue
    const fromToolArtifact = record.from.kind === 'artifact' && toolArtifactIds.has(record.from.id)
    const toToolArtifact = record.to.kind === 'artifact' && toolArtifactIds.has(record.to.id)
    const fromToolSpan = record.from.kind === 'span' && toolSpanIds.has(record.from.id)
    const toToolSpan = record.to.kind === 'span' && toolSpanIds.has(record.to.id)
    if (!(fromToolArtifact || toToolArtifact) || !(fromToolSpan || toToolSpan)) continue
    projected.push({
      t: 'edge',
      edgeType: record.edgeType,
      from: fromToolArtifact ? 'artifact' : 'span',
      to: toToolArtifact ? 'artifact' : 'span',
    })
  }

  return projected.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

describe('dialect parity — clean tool round protocol', () => {
  it('emits identical start/end hook sequences and tool-round messages', async () => {
    const toolCall = { id: 'tc_clean', name: 'echo', args: { v: 1 } }
    const tools = () => ({
      echo: { description: 'echo', execute: vi.fn(async (input: { v: number }) => `echo:${input.v}`) },
    })

    const nativeEvents = recordToolProtocol()
    const native = scriptedAdapterSpec([{ text: 'calling', toolCalls: [toolCall] }, { text: 'done' }])
    const nativeResult = await makeAdapter(native.spec)(native.client).generate(textPrompt(), {
      model: 'mock-model',
      input: { message: 'go' },
      tools: tools(),
    })
    const nativeProtocol = [...nativeEvents]
    resetRuntime()

    const executorEvents = recordToolProtocol()
    const fake = fakeLoopRuntime({ loops: [[{ text: 'calling', toolCalls: [toolCall] }, { text: 'done' }]] })
    const executorResult = await loopRuntimeAdapter(fake.runtime).generate(textPrompt(), {
      model: 'fake:mock-model',
      input: { message: 'go' },
      tools: tools(),
    })

    expect(executorEvents).toEqual(nativeProtocol)
    expect(nativeProtocol).toEqual([
      { t: 'start', toolCallId: 'tc_clean', toolName: 'echo', args: { v: 1 } },
      {
        t: 'end',
        toolCallId: 'tc_clean',
        toolName: 'echo',
        result: 'echo:1',
        modelOutputType: 'text',
        error: undefined,
      },
    ])
    expect(nativeResult.text).toBe('done')
    expect(executorResult.text).toBe('done')

    // The tool round the model saw is identical.
    const toolRound = (messages: readonly Message[]) =>
      messages.find((m) => m.role === 'tool' && m.metadata?.toolCallId === 'tc_clean')
    expect(toolRound(native.calls[1]!.messages)?.content).toBe('echo:1')
    // The fake's loop appends the round internally; assert the final histories agree.
    expect(toolRound(executorResult.messages)?.content).toBe(toolRound(nativeResult.messages)?.content)
  })

  it('emits identical live tool span and artifact structure in both dialects', async () => {
    const toolCall = { id: 'tc_observe', name: 'search', args: { query: 'refund' } }
    const tools = () => ({
      search: {
        description: 'Search docs',
        execute: vi.fn(async ({ query }: { query: string }) => ({ rows: [`result:${query}`], internalId: 42 })),
        toModelOutput: vi.fn(async ({ output }: { output: { rows: string[] } }) => ({
          type: 'json' as const,
          value: { rows: output.rows },
        })),
      },
    })

    const nativeTransport = createInMemoryObservabilityTransport()
    setObservabilityTransport(nativeTransport)
    const native = scriptedAdapterSpec([{ text: 'calling', toolCalls: [toolCall] }, { text: 'done' }])
    await makeAdapter(native.spec)(native.client).generate(textPrompt(), {
      model: 'mock-model',
      input: { message: 'go' },
      tools: tools(),
    })
    await observe.flush()
    const nativeEmission = projectToolEmission(nativeTransport.records, toolCall.id)
    resetObservabilityRuntime()

    const executorTransport = createInMemoryObservabilityTransport()
    setObservabilityTransport(executorTransport)
    const fake = fakeLoopRuntime({ loops: [[{ text: 'calling', toolCalls: [toolCall] }, { text: 'done' }]] })
    await loopRuntimeAdapter(fake.runtime).generate(textPrompt(), {
      model: 'fake:mock-model',
      input: { message: 'go' },
      tools: tools(),
    })
    await observe.flush()
    const executorEmission = projectToolEmission(executorTransport.records, toolCall.id)

    expect(executorEmission).toEqual(nativeEmission)
    expect(nativeEmission).toContainEqual(
      expect.objectContaining({ t: 'span:start', primitive: 'tool.call', name: 'search' }),
    )
    expect(nativeEmission).toContainEqual(expect.objectContaining({ t: 'artifact', kind: 'tool.args' }))
    expect(nativeEmission).toContainEqual(
      expect.objectContaining({
        t: 'artifact',
        kind: 'tool.result',
        attributes: expect.objectContaining({ resultKind: 'raw' }),
      }),
    )
    expect(nativeEmission).toContainEqual(
      expect.objectContaining({
        t: 'artifact',
        kind: 'tool.result',
        attributes: expect.objectContaining({ resultKind: 'model', modelOutputType: 'json' }),
      }),
    )
    expect(nativeEmission.filter((record) => record.t === 'edge')).toHaveLength(3)
  })

  it('call-site tool middleware modifies the input identically in both dialects', async () => {
    const toolCall = { id: 'tc_mw', name: 'echo', args: { v: 'raw' } }
    const rewriting = () =>
      toolMiddleware({
        id: 'rewriter',
        aroundExecute: async (call, next) => next({ v: `${(call.input as { v: string }).v}+mw` }, call.options),
      })

    async function run(kind: 'native' | 'executor') {
      const execute = vi.fn(async (input: { v: string }) => input.v)
      const tools = { echo: { description: 'echo', execute } }
      if (kind === 'native') {
        const native = scriptedAdapterSpec([{ text: '', toolCalls: [toolCall] }, { text: 'done' }])
        const result = await makeAdapter(native.spec)(native.client).generate(textPrompt(), {
          model: 'mock-model',
          input: { message: 'go' },
          tools,
          toolMiddleware: rewriting(),
        })
        return { execute, result }
      }
      const fake = fakeLoopRuntime({ loops: [[{ text: '', toolCalls: [toolCall] }, { text: 'done' }]] })
      const result = await loopRuntimeAdapter(fake.runtime).generate(textPrompt(), {
        model: 'fake:mock-model',
        input: { message: 'go' },
        tools,
        toolMiddleware: rewriting(),
      })
      return { execute, result }
    }

    const native = await run('native')
    const viaExecutor = await run('executor')

    expect(native.execute).toHaveBeenCalledWith({ v: 'raw+mw' }, expect.anything())
    expect(viaExecutor.execute).toHaveBeenCalledWith({ v: 'raw+mw' }, expect.anything())
    const toolRound = (messages: readonly Message[]) =>
      messages.find((m) => m.role === 'tool' && m.metadata?.toolCallId === 'tc_mw')
    expect(toolRound(viaExecutor.result.messages)?.content).toBe(toolRound(native.result.messages)?.content)
    expect(toolRound(native.result.messages)?.content).toBe('raw+mw')
  })
})

describe('dialect parity — approval protocol observability', () => {
  const toolCall = { id: 'tc_prot', name: 'dangerous', args: { target: 'db' } }

  it('suspension fires onToolApprovalRequest exactly once with the same approvalId, and nothing executes', async () => {
    const nativeEvents = recordToolProtocol()
    const native = scriptedAdapterSpec([{ text: 'need approval', toolCalls: [toolCall] }])
    await makeAdapter(native.spec)(native.client).generate(textPrompt(), {
      model: 'mock-model',
      input: { message: 'go' },
      tools: { dangerous: { description: 'risky', needsApproval: true, execute: vi.fn() } },
    })
    const nativeProtocol = [...nativeEvents]
    resetRuntime()

    const executorEvents = recordToolProtocol()
    const fake = fakeLoopRuntime({ loops: [[{ text: 'need approval', toolCalls: [toolCall] }]] })
    await loopRuntimeAdapter(fake.runtime).generate(textPrompt(), {
      model: 'fake:mock-model',
      input: { message: 'go' },
      tools: { dangerous: { description: 'risky', needsApproval: true, execute: vi.fn() } },
    })

    expect(executorEvents).toEqual(nativeProtocol)
    expect(nativeProtocol).toEqual([
      { t: 'approval.request', approvalId: 'approval_tc_prot', toolCallId: 'tc_prot', toolName: 'dangerous' },
    ])
  })

  it('resumes a denied call identically: never executes, same denial content, no start/end hooks', async () => {
    async function suspendThenDeny(kind: 'native' | 'executor') {
      const execute = vi.fn()
      const tools = { dangerous: { description: 'risky', needsApproval: true, execute } }
      const prompt = textPrompt()

      const suspended =
        kind === 'native'
          ? await (async () => {
              const first = scriptedAdapterSpec([{ text: 'need approval', toolCalls: [toolCall] }])
              return makeAdapter(first.spec)(first.client).generate(prompt, {
                model: 'mock-model',
                input: { message: 'go' },
                tools,
              })
            })()
          : await (async () => {
              const first = fakeLoopRuntime({ loops: [[{ text: 'need approval', toolCalls: [toolCall] }]] })
              return loopRuntimeAdapter(first.runtime).generate(prompt, {
                model: 'fake:mock-model',
                input: { message: 'go' },
                tools,
              })
            })()

      const request = (
        suspended.messages.at(-1)!.metadata as {
          toolApprovalRequests: Array<{ approvalId: string; approvalToken: string }>
        }
      ).toolApprovalRequests[0]!
      const messages = appendToolApprovalResponse(suspended.messages, {
        approvalId: request.approvalId,
        approved: false,
        reason: 'too risky',
        approvalToken: request.approvalToken,
      }) as Message[]

      const events = recordToolProtocol()
      const resumed =
        kind === 'native'
          ? await (async () => {
              const second = scriptedAdapterSpec([{ text: 'understood' }])
              return makeAdapter(second.spec)(second.client).generate(prompt, {
                model: 'mock-model',
                input: { message: 'go' },
                tools,
                messages,
              })
            })()
          : await (async () => {
              const second = fakeLoopRuntime({ loops: [[{ text: 'understood' }]] })
              return loopRuntimeAdapter(second.runtime).generate(prompt, {
                model: 'fake:mock-model',
                input: { message: 'go' },
                tools,
                messages,
              })
            })()
      const protocol = [...events]
      resetRuntime()

      const deniedRound = resumed.messages.find((m) => m.role === 'tool' && m.metadata?.toolCallId === toolCall.id)
      return { execute, protocol, deniedRound, text: resumed.text }
    }

    const native = await suspendThenDeny('native')
    const viaExecutor = await suspendThenDeny('executor')

    expect(native.execute).not.toHaveBeenCalled()
    expect(viaExecutor.execute).not.toHaveBeenCalled()
    // A denied call settles without executing — no start/end hook in either dialect.
    expect(viaExecutor.protocol).toEqual(native.protocol)
    expect(native.protocol).toEqual([])
    expect(viaExecutor.deniedRound?.content).toBe(native.deniedRound?.content)
    expect(native.deniedRound?.content).toBe('Tool execution denied: too risky')
    expect(native.text).toBe('understood')
    expect(viaExecutor.text).toBe('understood')
  })

  it('resumes an approved call with full observability in BOTH dialects (sdk resumes were blind)', async () => {
    async function suspendThenApprove(kind: 'native' | 'executor') {
      const execute = vi.fn(async () => 'deleted 3 rows')
      const tools = { dangerous: { description: 'risky', needsApproval: true, execute } }
      const prompt = textPrompt()

      const suspended =
        kind === 'native'
          ? await (async () => {
              const first = scriptedAdapterSpec([{ text: 'need approval', toolCalls: [toolCall] }])
              return makeAdapter(first.spec)(first.client).generate(prompt, {
                model: 'mock-model',
                input: { message: 'go' },
                tools,
              })
            })()
          : await (async () => {
              const first = fakeLoopRuntime({ loops: [[{ text: 'need approval', toolCalls: [toolCall] }]] })
              return loopRuntimeAdapter(first.runtime).generate(prompt, {
                model: 'fake:mock-model',
                input: { message: 'go' },
                tools,
              })
            })()

      const request = (
        suspended.messages.at(-1)!.metadata as {
          toolApprovalRequests: Array<{ approvalId: string; approvalToken: string }>
        }
      ).toolApprovalRequests[0]!
      const messages = appendToolApprovalResponse(suspended.messages, {
        approvalId: request.approvalId,
        approved: true,
        approvalToken: request.approvalToken,
      }) as Message[]

      const events = recordToolProtocol()
      if (kind === 'native') {
        const second = scriptedAdapterSpec([{ text: 'all done' }])
        await makeAdapter(second.spec)(second.client).generate(prompt, {
          model: 'mock-model',
          input: { message: 'go' },
          tools,
          messages,
        })
      } else {
        const second = fakeLoopRuntime({ loops: [[{ text: 'all done' }]] })
        await loopRuntimeAdapter(second.runtime).generate(prompt, {
          model: 'fake:mock-model',
          input: { message: 'go' },
          tools,
          messages,
        })
      }
      const protocol = [...events]
      resetRuntime()
      return protocol
    }

    const nativeProtocol = await suspendThenApprove('native')
    const executorProtocol = await suspendThenApprove('executor')

    // Divergence #1 fixed: the replayed call is fully observable in the
    // sdk dialect too — identical start/end sequence in both.
    expect(executorProtocol).toEqual(nativeProtocol)
    expect(nativeProtocol).toEqual([
      { t: 'start', toolCallId: 'tc_prot', toolName: 'dangerous', args: { target: 'db' } },
      {
        t: 'end',
        toolCallId: 'tc_prot',
        toolName: 'dangerous',
        result: 'deleted 3 rows',
        modelOutputType: 'text',
        error: undefined,
      },
    ])
  })

  it('rejects a forged approval token with the same error in both dialects', async () => {
    async function suspendThenForge(kind: 'native' | 'executor') {
      const tools = { dangerous: { description: 'risky', needsApproval: true, execute: vi.fn() } }
      const prompt = textPrompt()

      const suspended =
        kind === 'native'
          ? await makeAdapter(scriptedAdapterSpec([{ text: 'need approval', toolCalls: [toolCall] }]).spec)({
              kind: 'mock',
            }).generate(prompt, { model: 'mock-model', input: { message: 'go' }, tools })
          : await (async () => {
              const first = fakeLoopRuntime({ loops: [[{ text: 'need approval', toolCalls: [toolCall] }]] })
              return loopRuntimeAdapter(first.runtime).generate(prompt, {
                model: 'fake:mock-model',
                input: { message: 'go' },
                tools,
              })
            })()

      const request = (
        suspended.messages.at(-1)!.metadata as {
          toolApprovalRequests: Array<{ approvalId: string }>
        }
      ).toolApprovalRequests[0]!
      const messages = appendToolApprovalResponse(suspended.messages, {
        approvalId: request.approvalId,
        approved: true,
        approvalToken: 'forged-token',
      }) as Message[]

      if (kind === 'native') {
        const second = scriptedAdapterSpec([{ text: 'never' }])
        return makeAdapter(second.spec)(second.client)
          .generate(prompt, { model: 'mock-model', input: { message: 'go' }, tools, messages })
          .then(() => undefined)
          .catch((error: unknown) => error)
      }
      const second = fakeLoopRuntime({ loops: [[{ text: 'never' }]] })
      return loopRuntimeAdapter(second.runtime)
        .generate(prompt, { model: 'fake:mock-model', input: { message: 'go' }, tools, messages })
        .then(() => undefined)
        .catch((error: unknown) => error)
    }

    const nativeError = await suspendThenForge('native')
    const executorError = await suspendThenForge('executor')

    expect(nativeError).toBeInstanceOf(Error)
    expect(executorError).toBeInstanceOf(Error)
    expect((executorError as Error).message).toBe((nativeError as Error).message)
    expect((nativeError as Error).message).toContain('token mismatch')
  })
})

describe('dialect parity — skill load mid-loop', () => {
  it('augments the system prompt, refunds the step, and announces the skill identically', async () => {
    const skillPrompt = () =>
      makePrompt({
        id: 'parity-skill',
        system: 'You can load skills.',
        prompt: ({ input }) => (input as { message: string }).message,
        input: z.object({ message: z.string() }),
        use: [skill.inline({ id: 'sql-expert', description: 'SQL', instructions: 'Always parameterize queries.' })],
      })
    const loadCall = { id: 'tc_skill', name: LOAD_SKILL_TOOL_NAME, args: { name: 'sql-expert' } }

    const record = () => {
      const loads: string[] = []
      updateRuntime({ instrumentationHooks: { onSkillLoad: (event) => loads.push(event.skillId) } })
      return loads
    }

    const nativeLoads = record()
    const native = scriptedAdapterSpec([{ text: '', toolCalls: [loadCall] }, { text: 'skilled up' }])
    const nativeResult = await makeAdapter(native.spec)(native.client).generate(skillPrompt(), {
      model: 'mock-model',
      input: { message: 'go' },
    })
    resetRuntime()

    const executorLoads = record()
    const fake = fakeLoopRuntime({ loops: [[{ text: '', toolCalls: [loadCall] }, { text: 'skilled up' }]] })
    const executorResult = await loopRuntimeAdapter(fake.runtime).generate(skillPrompt(), {
      model: 'fake:mock-model',
      input: { message: 'go' },
    })
    resetRuntime()

    expect(nativeResult.text).toBe('skilled up')
    expect(executorResult.text).toBe('skilled up')
    // The LoadSkill step was refunded in both dialects.
    expect(nativeResult.steps).toBe(executorResult.steps)
    expect(nativeResult.steps).toBe(1)
    expect(nativeLoads).toEqual(['sql-expert'])
    expect(executorLoads).toEqual(['sql-expert'])
    // The re-armed system prompt carries the skill instructions in both
    // dialects: the native spec sees it on the post-amendment call, the
    // fake executor records the system in effect for the final step.
    expect(native.calls.at(-1)!.system).toContain('## Skill: sql-expert')
    expect(native.calls.at(-1)!.system).toContain('Always parameterize queries.')
    expect((executorResult.raw as { system?: string } | undefined)?.system).toContain('## Skill: sql-expert')
    expect((executorResult.raw as { system?: string } | undefined)?.system).toContain('Always parameterize queries.')
  })
})
