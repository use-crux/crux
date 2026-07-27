/** Terminal and execution-dialect parity for first-party memory ingress. */

import { describe, expect, it } from 'vitest'
import { adapter } from '../../src/adapter/define-adapter'
import { loopRuntimeAdapter } from '../../src/adapter/define-executor'
import type { CallArgs } from '../../src/adapter/types'
import { fakeLoopRuntime } from '../../src/adapter/testing'
import { memory, memoryBlock } from '../../src/memory'
import { prompt } from '../../src/prompt/prompt'
import { boundary, guardrail, GuardrailBlockedError } from '../../src/safety'
import {
  capturingRetrievalAdapter,
  consumeTextStream,
} from '../adapter/retrieval-input-safety.fixture'

describe('first-party memory ingress parity', () => {
  it('blocks Core and SDK generate/stream before provider transport', async () => {
    const policy = () =>
      guardrail({
        id: 'block-memory-ingress',
        on: boundary.input.text({ from: 'memory' }),
        run: () => ({
          action: 'block' as const,
          reason: 'unsafe memory context',
        }),
      })

    const coreCalls: CallArgs[] = []
    const core = adapter(capturingRetrievalAdapter(coreCalls))({})
    await expect(
      core.generate(makePrompt(), {
        model: 'test-model',
        guardrails: [policy()],
      }),
    ).rejects.toBeInstanceOf(GuardrailBlockedError)
    await expect(
      core.stream(makePrompt(), {
        model: 'test-model',
        guardrails: [policy()],
      }),
    ).rejects.toBeInstanceOf(GuardrailBlockedError)

    const sdkGenerate = fakeLoopRuntime({ loops: [[{ text: 'unreachable' }]] })
    await expect(
      loopRuntimeAdapter(sdkGenerate.runtime).generate(makePrompt(), {
        model: 'fake:test-model',
        guardrails: [policy()],
      }),
    ).rejects.toBeInstanceOf(GuardrailBlockedError)
    const sdkStream = fakeLoopRuntime({ streams: [['unreachable']] })
    await expect(
      loopRuntimeAdapter(sdkStream.runtime).stream(makePrompt(), {
        model: 'fake:test-model',
        guardrails: [policy()],
      }),
    ).rejects.toBeInstanceOf(GuardrailBlockedError)

    expect(coreCalls).toHaveLength(0)
    expect(sdkGenerate.calls.runTextLoop).toHaveLength(0)
    expect(sdkStream.calls.runStream).toHaveLength(0)
  })

  it('rewrites the same provider input in Core and SDK generate/stream', async () => {
    const policy = () =>
      guardrail({
        id: 'rewrite-memory-ingress',
        on: boundary.input.text({ from: 'memory' }),
        run: (text: string) => ({
          action: 'rewrite' as const,
          value: text.replace('private', 'safe'),
          rewrite: { kind: 'redact' as const },
        }),
      })

    const coreCalls: CallArgs[] = []
    const core = adapter(capturingRetrievalAdapter(coreCalls))({})
    await core.generate(makePrompt(), {
      model: 'test-model',
      guardrails: [policy()],
    })
    const coreStream = await core.stream(makePrompt(), {
      model: 'test-model',
      guardrails: [policy()],
    })
    await consumeTextStream(coreStream.textStream)
    await coreStream.completion

    const sdkGenerate = fakeLoopRuntime({ loops: [[{ text: 'done' }]] })
    await loopRuntimeAdapter(sdkGenerate.runtime).generate(makePrompt(), {
      model: 'fake:test-model',
      guardrails: [policy()],
    })
    const sdkStream = fakeLoopRuntime({ streams: [['done']] })
    const stream = await loopRuntimeAdapter(sdkStream.runtime).stream(
      makePrompt(),
      {
        model: 'fake:test-model',
        guardrails: [policy()],
      },
    )
    await stream.completion()

    const expected =
      'Trusted instructions.\n\n## Memory: summary\nsafe recalled memory'
    const requests = [
      ...coreCalls,
      ...sdkGenerate.calls.runTextLoop,
      ...sdkStream.calls.runStream,
    ]
    expect(requests.map((request) => request.system)).toEqual([
      expected,
      expected,
      expected,
      expected,
    ])
  })
})

function makePrompt() {
  const notes = memory({
    id: 'notes',
    namespace: 'thread:1',
    blocks: [
      memoryBlock({
        id: 'summary',
        kind: 'custom',
        render: () => 'private recalled memory',
      }),
    ],
  })
  return prompt({
    system: 'Trusted instructions.',
    use: [notes],
    prompt: 'Answer.',
  })
}
