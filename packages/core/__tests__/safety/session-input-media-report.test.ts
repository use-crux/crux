/** Report-mode input media guardrail behavior through the public safety session. */

import { describe, expect, it } from 'vitest'
import { boundary, createSafety, guardrail, type MediaPart } from '../../src/safety'

describe('guardInput — report-mode media boundaries', () => {
  it('reports a media strip without mutation and lets later bindings inspect the part', async () => {
    const seenLater: MediaPart[] = []
    const wouldStrip = guardrail({
      id: 'report-media-strip',
      on: boundary.input.media(),
      mode: 'report',
      run: () => ({ action: 'strip', reason: 'Would remove this image.' }),
    })
    const inspectLater = guardrail({
      id: 'inspect-report-preserved-media',
      on: boundary.input.media(),
      run: (subject) => {
        seenLater.push(subject.part)
        return { action: 'allow' }
      },
    })
    const image = { type: 'image', source: 'https://example.com/chart.png' } satisfies MediaPart
    const messages = [{ role: 'user' as const, content: [image] }]
    const safety = createSafety({
      call: { guardrails: [wouldStrip, inspectLater] },
      promptId: 'prompt-1',
      model: 'model-1',
    })

    const result = await safety.guardInput({ messages })

    expect(result.messages).toBe(messages)
    expect(seenLater).toEqual([image])
    expect(safety.audit.guardrails?.applied[0]).toMatchObject({
      guard: 'report-media-strip',
      mode: 'report',
      action: 'strip',
      reason: 'Would remove this image.',
    })
  })

  it('reports a media block without stopping later media bindings', async () => {
    const calls: string[] = []
    const wouldBlock = guardrail({
      id: 'report-media-block',
      on: boundary.input.media(),
      mode: 'report',
      run: () => {
        calls.push('block')
        return { action: 'block', reason: 'Would reject this image.' }
      },
    })
    const inspectLater = guardrail({
      id: 'inspect-after-report-block',
      on: boundary.input.media(),
      run: () => {
        calls.push('later')
        return { action: 'allow' }
      },
    })
    const messages = [
      { role: 'user' as const, content: [{ type: 'image' as const, source: 'https://example.com/chart.png' }] },
    ]
    const safety = createSafety({
      call: { guardrails: [wouldBlock, inspectLater] },
      promptId: 'prompt-1',
      model: 'model-1',
    })

    const result = await safety.guardInput({ messages })

    expect(result.messages).toBe(messages)
    expect(calls).toEqual(['block', 'later'])
    expect(safety.audit.guardrails?.applied[0]).toMatchObject({
      guard: 'report-media-block',
      mode: 'report',
      action: 'block',
      reason: 'Would reject this image.',
    })
  })
})
