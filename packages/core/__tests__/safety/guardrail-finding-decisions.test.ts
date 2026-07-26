import { describe, expect, it } from 'vitest'
import {
  boundary,
  createSafety,
  guardrail,
  GuardrailBlockedError,
  type SafetyOutput,
} from '../../src/safety'

const noRegeneration = async (): Promise<SafetyOutput> => {
  throw new Error('regeneration must not run')
}

describe('guardrail finding decisions', () => {
  it('preserves text findings in an enforcing block decision', async () => {
    const policy = guardrail({
      id: 'text-finding-block',
      on: boundary.output.text(),
      run: (_subject, ctx) => {
        ctx.findings.add({ type: 'classifier_match', count: 1 })
        return { action: 'block', reason: 'Classifier matched.' }
      },
    })
    const safety = createSafety({ call: { guardrails: [policy] } })

    const error = await safety
      .finalizeOutput({ text: 'protected output' }, noRegeneration)
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(GuardrailBlockedError)
    expect((error as GuardrailBlockedError).decisions[0]?.findings).toEqual([
      { type: 'classifier_match', count: 1 },
    ])
  })

  it('preserves per-segment findings in stream audit and block decisions', async () => {
    const policy = guardrail({
      id: 'stream-finding-block',
      on: boundary.output.text().deltas(),
      run: (_subject, ctx) => {
        ctx.findings.add({ type: 'stream_match', count: 1 })
        return { action: 'block', reason: 'Stream classifier matched.' }
      },
    })
    const safety = createSafety({ call: { guardrails: [policy] } })
    const stream = safety.openStream()

    const error = await stream.feed('blocked delta').catch(
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(GuardrailBlockedError)
    expect((error as GuardrailBlockedError).decisions[0]?.findings).toEqual([
      { type: 'stream_match', count: 1 },
    ])
    expect(safety.audit.guardrails?.applied[0]?.findings).toEqual([
      { type: 'stream_match', count: 1 },
    ])
  })
})
