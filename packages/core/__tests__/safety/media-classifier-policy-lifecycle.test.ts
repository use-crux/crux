import { describe, expect, it } from 'vitest'
import type { AssetRef } from '../../src'
import { bindCompletedOperation } from '../../src/adapter'
import {
  boundary,
  createSafety,
  guardrail,
  GuardrailBlockedError,
  SafetyConfigError,
  type MediaPart,
} from '../../src/safety'
import { guardSafetySessionOutputMedia } from '../../src/safety/session'
import {
  generatedImage,
  imageOperation,
} from '../adapter/completed-operation-safety-image.fixture'
import { classifierHarness } from './media-classifier-lifecycle.fixtures'

function inputPolicy(
  id: string,
  harness: ReturnType<typeof classifierHarness>,
  mode?: 'enforce' | 'report',
) {
  return guardrail({
    id,
    on: boundary.input.media(),
    ...(mode ? { mode } : {}),
    run: harness.run,
  })
}

function mediaMessages(parts: readonly MediaPart[]) {
  return [{ role: 'user' as const, content: parts }]
}

describe('media classifier policy lifecycle', () => {
  it('runs one body at the exact input/output media tuple only', async () => {
    const harness = classifierHarness()
    const policy = guardrail({
      id: 'tuple-classifier',
      on: [boundary.input.media(), boundary.output.media()] as const,
      run: harness.run,
    })
    const safety = createSafety({ call: { guardrails: [policy] } })

    await safety.guardInput({
      messages: mediaMessages([
        { type: 'image', source: new Uint8Array([1]) },
      ]),
    })
    await guardSafetySessionOutputMedia(safety, [{
      part: { type: 'audio', source: new Uint8Array([2]) },
      origin: { kind: 'step', stepIndex: 0, partIndex: 1 },
    }], { minimumRetained: 0 })

    expect(harness.parts.map((part) => part.type)).toEqual(['image', 'audio'])
    expect(safety.audit.guardrails?.applied.map((entry) => entry.boundary))
      .toEqual(['model.input.media', 'model.output.media'])
    expect(() => createSafety({
      call: {
        guardrails: [guardrail({
          id: 'mixed-tuple',
          on: [boundary.input.media(), boundary.output.text()] as const,
          run: harness.run as never,
        })],
      },
    })).toThrow(SafetyConfigError)
  })

  it('warns without mutation and strips only the matched part', async () => {
    const warn = classifierHarness({ action: 'warn', score: () => 0.9 })
    const warnSafety = createSafety({
      call: { guardrails: [inputPolicy('warn-classifier', warn)] },
    })
    const warnedMessages = mediaMessages([
      { type: 'image', source: new Uint8Array([1]) },
      { type: 'file', source: new Uint8Array([2]) },
    ])

    const warned = await warnSafety.guardInput({ messages: warnedMessages })

    expect(warned.messages).toBe(warnedMessages)
    expect(warn.calls).toBe(2)
    expect(warnSafety.audit.guardrails?.applied.map((entry) => entry.action))
      .toEqual(['warn', 'warn'])

    const strip = classifierHarness({
      action: 'strip',
      score: (_part, index) => index === 0 ? 0.9 : 0,
    })
    const stripSafety = createSafety({
      call: { guardrails: [inputPolicy('strip-classifier', strip)] },
    })
    const retained = { type: 'file' as const, source: new Uint8Array([4]) }

    const stripped = await stripSafety.guardInput({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Keep the file.' },
          { type: 'image', source: new Uint8Array([3]) },
          retained,
        ],
      }],
    })

    expect(stripped.messages[0]?.content).toEqual([
      { type: 'text', text: 'Keep the file.' },
      retained,
    ])
    expect(strip.calls).toBe(2)
  })

  it('stops on the first enforced block while report and warn continue', async () => {
    const block = classifierHarness({ action: 'block', score: () => 0.9 })
    const blockedSafety = createSafety({
      call: { guardrails: [inputPolicy('block-classifier', block)] },
    })
    const parts = [
      { type: 'image' as const, source: new Uint8Array([1]) },
      { type: 'image' as const, source: new Uint8Array([2]) },
    ]

    await expect(blockedSafety.guardInput({
      messages: mediaMessages(parts),
    })).rejects.toBeInstanceOf(GuardrailBlockedError)
    expect(block.calls).toBe(1)

    const report = classifierHarness({ action: 'block', score: () => 0.9 })
    const reportSafety = createSafety({
      call: {
        guardrails: [inputPolicy('report-classifier', report, 'report')],
      },
    })
    expect((await reportSafety.guardInput({
      messages: mediaMessages(parts),
    })).messages).toEqual(mediaMessages(parts))
    expect(report.calls).toBe(2)
  })

  it('retains findings and origin when a required strip escalates', async () => {
    const harness = classifierHarness({ action: 'strip', score: () => 0.9 })
    const generateImage = bindCompletedOperation({
      definition: imageOperation([]),
      provider: 'test',
      operation: 'generateImage',
    })

    const error = await generateImage({
      model: 'image-model',
      prompt: 'A quiet canal',
      guardrails: [guardrail({
        id: 'classify-required-image',
        on: boundary.output.media(),
        run: harness.run,
      })],
    }).then(() => undefined, (caught: unknown) => caught)

    expect(error).toBeInstanceOf(GuardrailBlockedError)
    expect(error).toMatchObject({
      decisions: [{
        action: 'block',
        escalatedToBlock: true,
        location: {
          origin: {
            kind: 'operation',
            operation: 'generateImage',
            phase: 'output',
            field: 'images',
            partIndex: 0,
          },
          partType: 'image',
        },
        findings: [{
          type: 'media_classifier_match',
          category: 'unsafe',
          score: 0.9,
          threshold: 0.8,
        }],
      }],
    })
  })

  it('tunes only posture and still propagates report-mode errors', async () => {
    const disabled = classifierHarness()
    const disabledSafety = createSafety({
      call: { guardrails: [inputPolicy('disabled-classifier', disabled)] },
      safety: { tune: { 'disabled-classifier': { enabled: false } } },
    })
    const image = mediaMessages([
      { type: 'image', source: new Uint8Array([1]) },
    ])
    await disabledSafety.guardInput({ messages: image })
    expect(disabled.calls).toBe(0)

    const shadow = classifierHarness({ action: 'strip', score: () => 0.9 })
    const shadowSafety = createSafety({
      call: { guardrails: [inputPolicy('tuned-classifier', shadow)] },
      safety: { tune: { 'tuned-classifier': { mode: 'report' } } },
    })
    expect((await shadowSafety.guardInput({ messages: image })).messages)
      .toBe(image)
    expect(shadowSafety.audit.guardrails?.applied[0]).toMatchObject({
      mode: 'report',
      action: 'strip',
    })

    for (const field of ['categories', 'threshold', 'model']) {
      expect(() => createSafety({
        call: { guardrails: [inputPolicy('fixed-classifier', shadow)] },
        safety: {
          tune: {
            'fixed-classifier': { [field]: field === 'threshold' ? 0.5 : [] },
          },
        } as never,
      })).toThrow(`cannot set "${field}"`)
    }

    const failure = new Error('classifier transport failed')
    const failing = classifierHarness({ error: failure })
    const failingSafety = createSafety({
      call: {
        guardrails: [inputPolicy('failing-classifier', failing, 'report')],
      },
    })
    await expect(failingSafety.guardInput({ messages: image }))
      .rejects.toBe(failure)
  })

  it('forwards sentinel sources without hydration and removes provider options', async () => {
    const harness = classifierHarness()
    const safety = createSafety({
      call: { guardrails: [inputPolicy('source-classifier', harness)] },
    })
    const url = new URL('https://example.com/sentinel.png')
    const ref: AssetRef = { uri: 'asset://must-not-hydrate' }
    const providerFile = {
      type: 'provider-file' as const,
      provider: 'sentinel',
      fileId: 'must-not-resolve',
    }

    await safety.guardInput({
      messages: mediaMessages([
        {
          type: 'image',
          source: url,
          providerOptions: { sentinel: { secret: 'omit' } },
        },
        {
          type: 'file',
          source: ref as never,
          providerOptions: { sentinel: { secret: 'omit' } },
        },
        {
          type: 'audio',
          source: providerFile,
          providerOptions: { sentinel: { secret: 'omit' } },
        },
      ]),
    })

    expect(harness.parts.map((part) => part.source)).toEqual([
      url,
      ref,
      providerFile,
    ])
    expect(harness.parts.every((part) => !('providerOptions' in part))).toBe(true)
  })
})
