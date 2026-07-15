/**
 * Regression coverage for exact registry bindings as observed through the
 * public per-call safety session.
 */

import { describe, expect, it } from 'vitest'
import { boundary, createSafety, guardrail } from '../../src/safety'

describe('createSafety — exact guardrail bindings', () => {
  it('runs and audits each boundary of an input/output text tuple exactly', async () => {
    const boundaries: string[] = []
    const policy = guardrail({
      id: 'input-output-policy',
      on: [boundary.input.text(), boundary.output.text()] as const,
      mode: 'report',
      run: (_subject, context) => {
        boundaries.push(context.boundary.id)
        return { action: 'allow' }
      },
    })
    const safety = createSafety({
      call: { guardrails: [policy] },
      promptId: 'prompt-1',
      model: 'model-1',
    })

    await safety.guardInput({ messages: [{ role: 'user', content: 'input' }] })
    await safety.finalizeOutput({ text: 'output' }, async () => {
      throw new Error('regeneration must not run')
    })

    expect(boundaries).toEqual(['user.input', 'model.output.text'])
    expect(safety.audit.guardrails?.applied).toEqual([
      expect.objectContaining({
        guard: 'input-output-policy',
        boundary: 'user.input',
        mode: 'report',
        phase: 'input',
      }),
      expect.objectContaining({
        guard: 'input-output-policy',
        boundary: 'model.output.text',
        mode: 'report',
        phase: 'output',
      }),
    ])
  })

  it('streams with the exact output binding and its tuned posture', async () => {
    const seen: Array<{ readonly boundary: string; readonly mode: string }> = []
    const policy = guardrail({
      id: 'stream-tuple-policy',
      on: [boundary.input.text(), boundary.output.text()] as const,
      stream: 'chunk',
      run: (subject, context) => {
        seen.push({ boundary: context.boundary.id, mode: context.policy.mode })
        return {
          action: 'rewrite',
          value: `${subject}-rewritten`,
          rewrite: { kind: 'normalize' },
        }
      },
    })
    const safety = createSafety({
      call: { guardrails: [policy] },
      promptId: 'prompt-1',
      model: 'model-1',
      safety: { tune: { 'stream-tuple-policy': { mode: 'report' } } },
    })

    const stream = safety.openStream()
    expect(await stream.feed('output')).toEqual({ kind: 'emit', content: 'output' })

    expect(seen).toEqual([{ boundary: 'model.output.text', mode: 'report' }])
    expect(safety.audit.guardrails?.applied).toContainEqual(
      expect.objectContaining({
        guard: 'stream-tuple-policy',
        boundary: 'model.output.text',
        mode: 'report',
        phase: 'output',
        action: 'transform',
      }),
    )
  })
})
