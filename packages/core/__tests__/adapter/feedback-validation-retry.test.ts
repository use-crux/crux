/** Validation corrective writeback parity across Core and SDK execution. */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { adapter } from '../../src/adapter/define-adapter'
import { loopRuntimeAdapter } from '../../src/adapter/define-executor'
import type { AdapterSpec } from '../../src/adapter/spec'
import { fakeLoopRuntime } from '../../src/adapter/testing'
import type { AdapterResponse, CallArgs } from '../../src/adapter/types'
import { prompt } from '../../src/prompt/prompt'
import { boundary, guardrail, GuardrailBlockedError } from '../../src/safety'
import { permissiveCapabilities } from './structured-output/capability-fixtures'

const structuredPrompt = prompt({
  id: 'feedback-validation-retry',
  prompt: 'Return JSON.',
  output: z.object({ value: z.string() }),
})

describe('validation feedback ingress', () => {
  it('guards rejected output and corrective text with legacy compatibility', async () => {
    const origins: unknown[] = []
    const legacyOrigins: unknown[] = []
    const policies = [
      guardrail({
        id: 'rewrite-validation-ingress',
        on: boundary.input.text({ from: 'feedback' }),
        run: (text, context) => {
          origins.push(context.origin)
          return {
            action: 'rewrite' as const,
            value: text
              .replace('{"value":1}', '{"value":"guarded"}')
              .replace('Validation failed', 'Guarded validation feedback'),
            rewrite: { kind: 'redact' as const },
          }
        },
      }),
      guardrail({
        id: 'legacy-validation-ingress',
        on: boundary.validation.feedback(),
        run: (text, context) => {
          legacyOrigins.push(context.origin)
          return {
            action: 'rewrite' as const,
            value: `${text}\nLegacy checked.`,
            rewrite: { kind: 'normalize' as const },
          }
        },
      }),
    ]

    const core = coreHarness(['{"value":1}', '{"value":"ok"}'])
    await adapter(core.spec)(core.client).generate(structuredPrompt, {
      model: 'test-model',
      validationRetry: { maxRetries: 1 },
      guardrails: policies,
    })

    const sdk = fakeLoopRuntime({
      structured: ['{"value":1}', '{"value":"ok"}'],
    })
    await loopRuntimeAdapter(sdk.runtime).generate(structuredPrompt, {
      model: 'fake:test-model',
      validationRetry: { maxRetries: 1 },
      guardrails: policies,
    })

    for (const request of [
      core.requests[1],
      sdk.calls.runStructuredAttempt[1],
    ]) {
      const writeback = textContents(request?.messages ?? [])
      expect(writeback).toContain('{"value":"guarded"}')
      expect(writeback).not.toContain('{"value":1}')
      expect(writeback.join('\n')).toContain('Guarded validation feedback')
      expect(writeback.join('\n')).toContain('Legacy checked.')
    }
    expect(origins).toEqual([
      { source: 'feedback', kind: 'rejected-output', attempt: 1 },
      { source: 'feedback', kind: 'validation-feedback', attempt: 1 },
      { source: 'feedback', kind: 'rejected-output', attempt: 1 },
      { source: 'feedback', kind: 'validation-feedback', attempt: 1 },
    ])
    expect(legacyOrigins).toEqual([
      { source: 'feedback', kind: 'validation-feedback', attempt: 1 },
      { source: 'feedback', kind: 'validation-feedback', attempt: 1 },
    ])
  })

  it('blocks before either dialect starts another physical attempt', async () => {
    const policy = () =>
      guardrail({
        id: 'block-validation-writeback',
        on: boundary.input.text({ from: 'feedback' }),
        run: () => ({
          action: 'block' as const,
          reason: 'unsafe corrective writeback',
        }),
      })
    const core = coreHarness(['{"value":1}', '{"value":"unreachable"}'])
    await expect(
      adapter(core.spec)(core.client).generate(structuredPrompt, {
        model: 'test-model',
        validationRetry: { maxRetries: 1 },
        guardrails: [policy()],
      }),
    ).rejects.toBeInstanceOf(GuardrailBlockedError)
    expect(core.requests).toHaveLength(1)

    const sdk = fakeLoopRuntime({
      structured: ['{"value":1}', '{"value":"unreachable"}'],
    })
    await expect(
      loopRuntimeAdapter(sdk.runtime).generate(structuredPrompt, {
        model: 'fake:test-model',
        validationRetry: { maxRetries: 1 },
        guardrails: [policy()],
      }),
    ).rejects.toBeInstanceOf(GuardrailBlockedError)
    expect(sdk.calls.runStructuredAttempt).toHaveLength(1)
  })

  it('records a report block but retries with the original envelope', async () => {
    const policy = guardrail({
      id: 'report-validation-writeback',
      mode: 'report',
      on: boundary.input.text({ from: 'feedback' }),
      run: () => ({
        action: 'block' as const,
        reason: 'observe only',
      }),
    })
    const core = coreHarness(['{"value":1}', '{"value":"ok"}'])
    const result = await adapter(core.spec)(core.client).generate(
      structuredPrompt,
      {
        model: 'test-model',
        validationRetry: { maxRetries: 1 },
        guardrails: [policy],
      },
    )

    expect(core.requests).toHaveLength(2)
    const writeback = textContents(core.requests[1]?.messages ?? [])
    expect(writeback).toContain('{"value":1}')
    expect(writeback.join('\n')).toContain('Validation failed')
    expect(result._meta.guardrails?.applied).toEqual([
      expect.objectContaining({ action: 'block', mode: 'report' }),
      expect.objectContaining({ action: 'block', mode: 'report' }),
    ])

    const sdk = fakeLoopRuntime({
      structured: ['{"value":1}', '{"value":"ok"}'],
    })
    const sdkResult = await loopRuntimeAdapter(sdk.runtime).generate(
      structuredPrompt,
      {
        model: 'fake:test-model',
        validationRetry: { maxRetries: 1 },
        guardrails: [policy],
      },
    )

    expect(sdk.calls.runStructuredAttempt).toHaveLength(2)
    const sdkWriteback = textContents(
      sdk.calls.runStructuredAttempt[1]?.messages ?? [],
    )
    expect(sdkWriteback).toContain('{"value":1}')
    expect(sdkWriteback.join('\n')).toContain('Validation failed')
    expect(sdkResult._meta.guardrails?.applied).toEqual([
      expect.objectContaining({ action: 'block', mode: 'report' }),
      expect.objectContaining({ action: 'block', mode: 'report' }),
    ])
  })
})

function coreHarness(outputs: readonly string[]) {
  const queue = [...outputs]
  const requests: CallArgs[] = []
  const client = { kind: 'feedback-validation' as const }
  const spec: AdapterSpec<typeof client, object, never> = {
    providerId: 'feedback-validation',
    structuredOutput: { accepts: permissiveCapabilities },
    async call(_client, args) {
      requests.push(args)
      return { raw: {}, extracted: response(queue.shift() ?? '') }
    },
    async stream() {
      throw new Error('not used')
    },
    appendToolRound(messages, assistant) {
      return [...messages, { role: 'assistant', content: assistant.text }]
    },
    mapSettings: (settings) => ({ ...settings }),
  }
  return { client, spec, requests }
}

function response(text: string): AdapterResponse {
  return {
    text,
    usage: undefined,
    finishReason: 'stop',
    responseId: undefined,
    actualModelId: undefined,
  }
}

function textContents(
  messages: readonly import('../../src/generation/messages').Message[],
): string[] {
  return messages.flatMap((message) =>
    typeof message.content === 'string'
      ? [message.content]
      : message.content.flatMap((part) =>
          part.type === 'text' || part.type === 'reasoning' ? [part.text] : [],
        ),
  )
}
