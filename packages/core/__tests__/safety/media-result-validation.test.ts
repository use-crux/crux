/** Fail-closed runtime validation for JavaScript-shaped media guardrails. */

import { describe, expect, it } from 'vitest'
import {
  boundary,
  createSafety,
  evaluateGuardrail,
  guardrail,
  SafetyConfigError,
  SafetyResultError,
} from '../../src/safety'

const mediaMessages = [
  {
    role: 'user' as const,
    content: [{ type: 'image' as const, source: 'https://example.com/chart.png' }],
  },
]

describe('input media guardrail validation', () => {
  it.each([
    ['missing', undefined],
    ['empty', ''],
  ] as const)('rejects a media strip with a %s reason before later callbacks run', async (_case, reason) => {
    let laterCalls = 0
    const malformed = guardrail({
      id: 'invalid-strip-reason',
      on: boundary.input.media(),
      run: (() =>
        reason === undefined ? { action: 'strip' } : { action: 'strip', reason }) as never,
    })
    const later = guardrail({
      id: 'after-invalid-strip',
      on: boundary.input.media(),
      run: () => {
        laterCalls++
        return { action: 'allow' }
      },
    })
    const safety = createSafety({
      call: { guardrails: [malformed, later] },
      promptId: 'prompt-1',
      model: 'model-1',
    })

    await expect(safety.guardInput({ messages: mediaMessages })).rejects.toMatchObject({
      name: SafetyResultError.name,
      policyId: 'invalid-strip-reason',
      boundary: 'model.input.media',
    })
    expect(laterCalls).toBe(0)
  })

  it('rejects a media rewrite result', async () => {
    const malformed = guardrail({
      id: 'invalid-media-rewrite-result',
      on: boundary.input.media(),
      run: (() => ({
        action: 'rewrite',
        value: 'replacement',
        rewrite: { kind: 'normalize' },
      })) as never,
    })
    const safety = createSafety({
      call: { guardrails: [malformed] },
      promptId: 'prompt-1',
      model: 'model-1',
    })

    await expect(safety.guardInput({ messages: mediaMessages })).rejects.toMatchObject({
      name: SafetyResultError.name,
      policyId: 'invalid-media-rewrite-result',
      boundary: 'model.input.media',
      problem: expect.stringMatching(/rewrite/),
    })
  })

  it('rejects a media hold result', async () => {
    const malformed = guardrail({
      id: 'invalid-media-hold-result',
      on: boundary.input.media(),
      run: (() => ({ action: 'hold' })) as never,
    })
    const safety = createSafety({
      call: { guardrails: [malformed] },
      promptId: 'prompt-1',
      model: 'model-1',
    })

    await expect(safety.guardInput({ messages: mediaMessages })).rejects.toMatchObject({
      name: SafetyResultError.name,
      policyId: 'invalid-media-hold-result',
      boundary: 'model.input.media',
      problem: expect.stringMatching(/hold/),
    })
  })

  it('rejects strip from a text guardrail', async () => {
    const malformed = guardrail({
      id: 'invalid-text-strip-result',
      on: boundary.input.text(),
      run: (() => ({ action: 'strip', reason: 'Not a text action.' })) as never,
    })
    const safety = createSafety({
      call: { guardrails: [malformed] },
      promptId: 'prompt-1',
      model: 'model-1',
    })

    await expect(
      safety.guardInput({ messages: [{ role: 'user', content: 'text' }] }),
    ).rejects.toMatchObject({
      name: SafetyResultError.name,
      policyId: 'invalid-text-strip-result',
      boundary: 'model.input.text',
      problem: expect.stringMatching(/strip/),
    })
  })

  it('rejects an unknown media action', async () => {
    const malformed = guardrail({
      id: 'unknown-media-result',
      on: boundary.input.media(),
      run: (() => ({ action: 'replace' })) as never,
    })
    const safety = createSafety({
      call: { guardrails: [malformed] },
      promptId: 'prompt-1',
      model: 'model-1',
    })

    await expect(safety.guardInput({ messages: mediaMessages })).rejects.toMatchObject({
      name: SafetyResultError.name,
      policyId: 'unknown-media-result',
      boundary: 'model.input.media',
      problem: expect.stringMatching(/replace/),
    })
  })

  it('rejects a mixed media and text boundary tuple before callbacks run', () => {
    let calls = 0
    const malformed = guardrail({
      id: 'mixed-media-text-runtime',
      on: [boundary.input.media(), boundary.input.text()] as never,
      run: (() => {
        calls++
        return { action: 'allow' }
      }) as never,
    })

    expect(() =>
      createSafety({
        call: { guardrails: [malformed] },
        promptId: 'prompt-1',
        model: 'model-1',
      }),
    ).toThrow(SafetyConfigError)
    expect(calls).toBe(0)
  })

  it('rejects authored stream configuration on a media guardrail before callbacks run', () => {
    let calls = 0
    const malformed = guardrail({
      id: 'media-stream-runtime',
      on: boundary.input.media(),
      stream: 'sentence',
      run: () => {
        calls++
        return { action: 'allow' }
      },
    } as never)

    expect(() =>
      createSafety({
        call: { guardrails: [malformed] },
        promptId: 'prompt-1',
        model: 'model-1',
      }),
    ).toThrow(SafetyConfigError)
    expect(calls).toBe(0)
  })

  it('rejects per-call stream tuning on a media guardrail before callbacks run', () => {
    let calls = 0
    const policy = guardrail({
      id: 'tuned-media-stream-runtime',
      on: boundary.input.media(),
      run: () => {
        calls++
        return { action: 'allow' }
      },
    })

    expect(() =>
      createSafety({
        call: { guardrails: [policy] },
        promptId: 'prompt-1',
        model: 'model-1',
        safety: { tune: { 'tuned-media-stream-runtime': { stream: 'final' } } },
      }),
    ).toThrow(SafetyConfigError)
    expect(calls).toBe(0)
  })

  it('preserves valid media mode and enabled tuning', async () => {
    let disabledCalls = 0
    const reportStrip = guardrail({
      id: 'tuned-media-report',
      on: boundary.input.media(),
      run: () => ({ action: 'strip', reason: 'Report only.' }),
    })
    const disabled = guardrail({
      id: 'tuned-media-disabled',
      on: boundary.input.media(),
      run: () => {
        disabledCalls++
        return { action: 'allow' }
      },
    })
    const safety = createSafety({
      call: { guardrails: [reportStrip, disabled] },
      promptId: 'prompt-1',
      model: 'model-1',
      safety: {
        tune: {
          'tuned-media-report': { mode: 'report' },
          'tuned-media-disabled': { enabled: false },
        },
      },
    })

    const result = await safety.guardInput({ messages: mediaMessages })

    expect(result.messages).toBe(mediaMessages)
    expect(disabledCalls).toBe(0)
    expect(safety.audit.guardrails?.applied).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ guard: 'tuned-media-report', mode: 'report', action: 'strip' }),
        expect.objectContaining({ guard: 'tuned-media-disabled', reason: 'disabled by call site' }),
      ]),
    )
  })

  it('rejects media guardrails in the standalone string evaluator before callbacks run', async () => {
    let calls = 0
    const policy = guardrail({
      id: 'media-string-evaluator',
      on: boundary.input.media(),
      run: () => {
        calls++
        return { action: 'allow' }
      },
    })

    await expect(
      evaluateGuardrail(policy, [{ input: 'not media', expect: 'allow' }]),
    ).rejects.toBeInstanceOf(SafetyConfigError)
    expect(calls).toBe(0)
  })
})
