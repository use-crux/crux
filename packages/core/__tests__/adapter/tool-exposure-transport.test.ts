/** Tool-definition blocks stop every adapter path before provider transport. */

import { describe, expect, it } from 'vitest'
import { adapter } from '../../src/adapter/define-adapter'
import { loopRuntimeAdapter } from '../../src/adapter/define-executor'
import { fakeLoopRuntime } from '../../src/adapter/testing'
import {
  boundary,
  guardrail,
  GuardrailBlockedError,
} from '../../src/safety'
import {
  toolIngressPrompt,
  toolIngressScript,
} from './tool-ingress.fixture'

const tools = {
  lookup: {
    description: 'private lookup',
    execute: async () => 'result',
  },
}

function blockingGuardrail() {
  return guardrail({
    id: 'block-tool-definition',
    on: boundary.input.tools(),
    run: (subject, context) => {
      expect(subject.name).toBe('lookup')
      expect(context.origin).toEqual({
        source: 'tool-definition',
        kind: 'authored',
        toolName: 'lookup',
      })
      return { action: 'block' as const, reason: 'not exposed' }
    },
  })
}

describe('tool exposure transport gate', () => {
  it('blocks Core generate', async () => {
    const scripted = toolIngressScript([{ text: 'unreachable' }])
    const runtime = adapter(scripted.spec)(scripted.client)

    await expect(
      runtime.generate(toolIngressPrompt(), {
        model: 'test-model',
        input: { message: 'go' },
        tools,
        guardrails: [blockingGuardrail()],
      }),
    ).rejects.toBeInstanceOf(GuardrailBlockedError)
    expect(scripted.calls).toBe(0)
  })

  it('blocks SDK generate', async () => {
    const fake = fakeLoopRuntime({ loops: [[{ text: 'unreachable' }]] })

    await expect(
      loopRuntimeAdapter(fake.runtime).generate(toolIngressPrompt(), {
        model: 'fake:test-model',
        input: { message: 'go' },
        tools,
        guardrails: [blockingGuardrail()],
      }),
    ).rejects.toBeInstanceOf(GuardrailBlockedError)
    expect(fake.calls.runTextLoop).toHaveLength(0)
  })

  it('blocks Core stream', async () => {
    const scripted = toolIngressScript([])
    const runtime = adapter(scripted.spec)(scripted.client)

    await expect(
      runtime.stream(toolIngressPrompt(), {
        model: 'test-model',
        input: { message: 'go' },
        tools,
        guardrails: [blockingGuardrail()],
      }),
    ).rejects.toBeInstanceOf(GuardrailBlockedError)
    expect(scripted.calls).toBe(0)
  })

  it('blocks SDK stream', async () => {
    const fake = fakeLoopRuntime({ streams: [['unreachable']] })

    await expect(
      loopRuntimeAdapter(fake.runtime).stream(toolIngressPrompt(), {
        model: 'fake:test-model',
        input: { message: 'go' },
        tools,
        guardrails: [blockingGuardrail()],
      }),
    ).rejects.toBeInstanceOf(GuardrailBlockedError)
    expect(fake.calls.runStream).toHaveLength(0)
  })
})
