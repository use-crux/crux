/** Core-owned semantic model-ingress capability behavior. */

import { describe, expect, it } from 'vitest'
import { contentText } from '../../src/content'
import { boundary, createSafety, guardrail } from '../../src/safety'
import { guardSafetySessionModelIngress } from '../../src/safety/session'

describe('model ingress', () => {
  it('strips media before text projection and preserves retained part identity', async () => {
    const text = Object.freeze({ type: 'text' as const, text: 'private summary' })
    const removed = Object.freeze({
      type: 'image' as const,
      source: new Uint8Array([1]),
      mediaType: 'image/png',
    })
    const retained = Object.freeze({
      type: 'image' as const,
      source: new Uint8Array([2]),
      mediaType: 'image/png',
    })
    const expectedProjection = contentText([text, retained])
    const order: string[] = []
    const safety = createSafety({
      call: {
        guardrails: [
          guardrail({
            id: 'strip-selected-tool-media',
            on: boundary.input.media({ from: 'tool' }),
            run: (subject) => {
              order.push(subject.part === removed ? 'media:removed' : 'media:retained')
              return subject.part === removed
                ? { action: 'strip', reason: 'remove selected image' }
                : { action: 'allow' }
            },
          }),
          guardrail({
            id: 'rewrite-retained-tool-projection',
            on: boundary.input.text({ from: 'tool' }),
            run: (projection) => {
              order.push('text')
              expect(projection).toBe(expectedProjection)
              return {
                action: 'rewrite',
                value: projection.replace('private', 'safe'),
                rewrite: { kind: 'redact' },
              }
            },
          }),
        ],
      },
    })

    const guarded = await guardSafetySessionModelIngress(safety, {
      kind: 'content',
      value: [text, removed, retained],
      origin: {
        source: 'tool',
        kind: 'tool-result',
        toolName: 'lookup',
        toolCallId: 'call-1',
      },
    })

    expect(order).toEqual(['media:removed', 'media:retained', 'text'])
    expect(guarded.kind).toBe('content')
    if (guarded.kind !== 'content') throw new Error('expected content')
    expect(guarded.value).toHaveLength(2)
    expect(guarded.value[0]).toEqual({ type: 'text', text: 'safe summary' })
    expect(guarded.value[1]).toBe(retained)
  })
})
