/** Runtime validation for the public output-media boundary. */

import { describe, expect, it, vi } from 'vitest'
import { boundary, constraint, createSafety, evaluateGuardrail, guardrail, SafetyConfigError } from '../../src/safety'

describe('output media boundary', () => {
  it('rejects an unsafe-cast media and text tuple before callback execution', () => {
    const run = vi.fn(() => ({ action: 'allow' as const }))
    const malformed = guardrail({
      id: 'mixed-output-media-text',
      on: [boundary.output.media(), boundary.output.text()] as never,
      run,
    })

    expect(() =>
      createSafety({
        call: { guardrails: [malformed] },
        promptId: undefined,
        model: 'image-model',
      }),
    ).toThrow(SafetyConfigError)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects unsafe-cast stream configuration before callback execution', () => {
    const run = vi.fn(() => ({ action: 'allow' as const }))
    const malformed = guardrail({
      id: 'streaming-output-media',
      on: boundary.output.media(),
      stream: 'sentence',
      run,
    } as never)

    expect(() =>
      createSafety({
        call: { guardrails: [malformed] },
        promptId: undefined,
        model: 'image-model',
      }),
    ).toThrow(SafetyConfigError)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects unsafe-cast constraints before callback execution', () => {
    const run = vi.fn(() => ({ pass: true as const }))

    expect(() =>
      constraint({
        id: 'constrained-output-media',
        on: boundary.output.media(),
        run,
      } as never),
    ).toThrow(SafetyConfigError)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects output media in the standalone string evaluator', async () => {
    const run = vi.fn(() => ({ action: 'allow' as const }))
    const policy = guardrail({
      id: 'evaluate-output-media',
      on: boundary.output.media(),
      run,
    })

    await expect(evaluateGuardrail(policy, [{ input: 'not media', expect: 'allow' }])).rejects.toBeInstanceOf(
      SafetyConfigError,
    )
    expect(run).not.toHaveBeenCalled()
  })
})
