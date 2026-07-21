/** Input media traversal through the public safety session. */

import { describe, expect, it } from 'vitest'
import { boundary, createSafety, guardrail, type MediaPart, type MediaPartSubject } from '../../src/safety'

describe('guardInput — media traversal', () => {
  it('passes each original canonical part and location before leaving input unchanged on allow', async () => {
    const image = {
      type: 'image',
      source: new Uint8Array([1, 2, 3]),
      mediaType: 'image/png',
    } satisfies MediaPart
    const seen: Array<{ readonly subject: MediaPartSubject; readonly boundary: string }> = []
    const policy = guardrail({
      id: 'inspect-media',
      on: boundary.input.media(),
      run: (subject, context) => {
        seen.push({ subject, boundary: context.boundary.id })
        return { action: 'allow' }
      },
    })
    const messages = [
      { role: 'system' as const, content: 'system' },
      {
        role: 'user' as const,
        content: [{ type: 'text' as const, text: 'Inspect this.' }, image],
      },
    ]
    const safety = createSafety({
      call: { guardrails: [policy] },
      promptId: 'prompt-1',
      model: 'model-1',
    })

    const result = await safety.guardInput({ messages })

    expect(seen).toEqual([
      {
        subject: {
          part: image,
          origin: { kind: 'message', messageIndex: 1, partIndex: 1 },
        },
        boundary: 'model.input.media',
      },
    ])
    expect(seen[0]?.subject.part).toBe(image)
    expect(result.messages).toBe(messages)
  })

  it('runs media guards before projecting the resulting input for text guards', async () => {
    const order: string[] = []
    const mediaPolicy = guardrail({
      id: 'media-first',
      on: boundary.input.media(),
      run: () => {
        order.push('media')
        return { action: 'allow' }
      },
    })
    const textPolicy = guardrail({
      id: 'text-second',
      on: boundary.input.text(),
      run: () => {
        order.push('text')
        return { action: 'allow' }
      },
    })
    const image = { type: 'image', source: 'https://example.com/chart.png' } satisfies MediaPart
    const safety = createSafety({
      call: { guardrails: [mediaPolicy, textPolicy] },
      promptId: 'prompt-1',
      model: 'model-1',
    })

    await safety.guardInput({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Inspect this.' }, image] }],
    })

    expect(order).toEqual(['media', 'text'])
  })

  it('leaves media guards idle for a bare prompt while text guards still run', async () => {
    const calls = { media: 0, text: 0 }
    const mediaPolicy = guardrail({
      id: 'no-bare-media',
      on: boundary.input.media(),
      run: () => {
        calls.media++
        return { action: 'allow' }
      },
    })
    const textPolicy = guardrail({
      id: 'guard-bare-text',
      on: boundary.input.text(),
      run: () => {
        calls.text++
        return { action: 'allow' }
      },
    })
    const safety = createSafety({
      call: { guardrails: [mediaPolicy, textPolicy] },
      promptId: 'prompt-1',
      model: 'model-1',
    })

    const result = await safety.guardInput({ messages: [], prompt: 'Inspect this.' })

    expect(calls).toEqual({ media: 0, text: 1 })
    expect(result).toEqual({ messages: [], prompt: 'Inspect this.' })
  })

  it('visits media deterministically by message, original part, then binding', async () => {
    const order: string[] = []
    const policy = (id: string) =>
      guardrail({
        id,
        on: boundary.input.media(),
        run: (subject) => {
          if (subject.origin.kind !== 'message') throw new Error('Expected message origin.')
          order.push(`${subject.origin.messageIndex}:${subject.origin.partIndex}:${id}`)
          return { action: 'allow' }
        },
      })
    const safety = createSafety({
      call: { guardrails: [policy('a'), policy('b')] },
      promptId: 'prompt-1',
      model: 'model-1',
    })

    await safety.guardInput({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: 'https://example.com/a.png' },
            { type: 'file', source: 'https://example.com/a.pdf' },
          ],
        },
        { role: 'assistant', content: [{ type: 'image', source: 'https://example.com/ignored.png' }] },
        { role: 'user', content: [{ type: 'video', source: 'https://example.com/a.mp4' }] },
      ],
    })

    expect(order).toEqual(['0:0:a', '0:0:b', '0:1:a', '0:1:b', '2:0:a', '2:0:b'])
  })

  it('keeps later subject and audit indexes in original coordinates after a strip', async () => {
    const seen: number[] = []
    const stripFirst = guardrail({
      id: 'strip-first-coordinate',
      on: boundary.input.media(),
      run: (subject) =>
        subject.part.type === 'image'
          ? { action: 'strip', reason: 'Remove the first part.' }
          : { action: 'allow' },
    })
    const inspectLater = guardrail({
      id: 'inspect-original-coordinate',
      on: boundary.input.media(),
      run: (subject) => {
        if (subject.origin.kind !== 'message') throw new Error('Expected message origin.')
        seen.push(subject.origin.partIndex)
        return { action: 'allow' }
      },
    })
    const safety = createSafety({
      call: { guardrails: [stripFirst, inspectLater] },
      promptId: 'prompt-1',
      model: 'model-1',
    })

    await safety.guardInput({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: 'https://example.com/a.png' },
            { type: 'file', source: 'https://example.com/a.pdf' },
          ],
        },
      ],
    })

    expect(seen).toEqual([1])
    expect(safety.audit.guardrails?.applied).toContainEqual(
      expect.objectContaining({
        guard: 'inspect-original-coordinate',
        location: {
          origin: { kind: 'message', messageIndex: 0, partIndex: 1 },
          partType: 'file',
        },
      }),
    )
  })

  it('strips from frozen inputs without mutating their arrays, objects, or sibling parts', async () => {
    const text = Object.freeze({ type: 'text' as const, text: 'Keep this.' })
    const image = Object.freeze({ type: 'image' as const, source: 'https://example.com/remove.png' })
    const file = Object.freeze({ type: 'file' as const, source: 'https://example.com/keep.pdf' })
    const content = Object.freeze([text, image, file])
    const user = Object.freeze({ role: 'user' as const, content })
    const system = Object.freeze({ role: 'system' as const, content: 'System instructions.' })
    const messages = Object.freeze([system, user])
    const stripImage = guardrail({
      id: 'strip-from-frozen-input',
      on: boundary.input.media(),
      run: (subject) =>
        subject.part.type === 'image'
          ? { action: 'strip', reason: 'Images are not accepted.' }
          : { action: 'allow' },
    })
    const safety = createSafety({
      call: { guardrails: [stripImage] },
      promptId: 'prompt-1',
      model: 'model-1',
    })

    const result = await safety.guardInput({ messages })

    expect(result.messages).not.toBe(messages)
    expect(result.messages[0]).toBe(system)
    expect(result.messages[1]).not.toBe(user)
    expect(result.messages[1]?.content).toEqual([text, file])
    expect((result.messages[1] as { readonly content: readonly unknown[] }).content[0]).toBe(text)
    expect((result.messages[1] as { readonly content: readonly unknown[] }).content[1]).toBe(file)
    expect(user.content).toBe(content)
    expect(content).toEqual([text, image, file])
  })
})
