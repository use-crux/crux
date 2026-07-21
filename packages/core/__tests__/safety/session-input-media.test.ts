/** Input media guardrail behavior through the public safety session. */

import { describe, expect, it } from 'vitest'
import { boundary, createSafety, guardrail, GuardrailBlockedError, type MediaPart } from '../../src/safety'

describe('guardInput — media boundaries', () => {
  it('dispatches user source and coordinates before applying media filters', async () => {
    const seen: unknown[] = []
    const user = guardrail({
      id: 'user-media-origin',
      on: boundary.input.media({ from: 'user' }),
      run: (subject, context) => {
        seen.push({ callback: context.origin, subject: subject.origin })
        return { action: 'allow' }
      },
    })
    const tool = guardrail({
      id: 'tool-media-origin',
      on: boundary.input.media({ from: 'tool' }),
      run: () => {
        seen.push('unexpected-tool')
        return { action: 'allow' }
      },
    })
    const safety = createSafety({ call: { guardrails: [user, tool] } })

    await safety.guardInput({
      messages: [
        { role: 'assistant', content: 'prior' },
        {
          role: 'user',
          content: [{ type: 'image', source: 'https://example.com/chart.png' }],
        },
      ],
    })

    expect(seen).toEqual([
      {
        callback: {
          source: 'user',
          kind: 'message',
          messageIndex: 1,
          partIndex: 0,
        },
        subject: { kind: 'message', messageIndex: 1, partIndex: 0 },
      },
    ])
  })

  it('audits media warnings with their reason and continues to later bindings', async () => {
    const order: string[] = []
    const warn = guardrail({
      id: 'warn-media',
      on: boundary.input.media(),
      run: () => {
        order.push('warn')
        return { action: 'warn', reason: 'Review this image.' }
      },
    })
    const later = guardrail({
      id: 'later-media',
      on: boundary.input.media(),
      run: () => {
        order.push('later')
        return { action: 'allow' }
      },
    })
    const safety = createSafety({
      call: { guardrails: [warn, later] },
      promptId: 'prompt-1',
      model: 'model-1',
    })

    await safety.guardInput({
      messages: [
        {
          role: 'user',
          content: [{ type: 'image', source: 'https://example.com/chart.png' }],
        },
      ],
    })

    expect(order).toEqual(['warn', 'later'])
    expect(safety.audit.guardrails?.applied[0]).toMatchObject({
      guard: 'warn-media',
      boundary: 'model.input.media',
      action: 'warn',
      reason: 'Review this image.',
    })
  })

  it('stops later media and text bindings when an enforcing media guard blocks', async () => {
    const later: string[] = []
    const block = guardrail({
      id: 'block-media',
      on: boundary.input.media(),
      run: () => ({ action: 'block', reason: 'Unsupported image.' }),
    })
    const laterMedia = guardrail({
      id: 'later-media-after-block',
      on: boundary.input.media(),
      run: () => {
        later.push('media')
        return { action: 'allow' }
      },
    })
    const laterText = guardrail({
      id: 'later-text-after-block',
      on: boundary.input.text(),
      run: () => {
        later.push('text')
        return { action: 'allow' }
      },
    })
    const safety = createSafety({
      call: { guardrails: [block, laterMedia, laterText] },
      promptId: 'prompt-1',
      model: 'model-1',
    })

    const error = await safety
      .guardInput({
        messages: [
          {
            role: 'user',
            content: [{ type: 'image', source: 'https://example.com/chart.png' }],
          },
        ],
      })
      .then(() => undefined)
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(GuardrailBlockedError)
    expect((error as GuardrailBlockedError).decisions[0]).toMatchObject({
      policyId: 'block-media',
      boundary: 'model.input.media',
      mode: 'enforce',
      action: 'block',
      reason: 'Unsupported image.',
    })
    expect(later).toEqual([])
  })

  it('immutably strips one media part and skips later bindings only for that part', async () => {
    const image = {
      type: 'image',
      source: 'https://example.com/chart.png',
    } satisfies MediaPart
    const file = {
      type: 'file',
      source: 'https://example.com/report.pdf',
    } satisfies MediaPart
    const seenLater: string[] = []
    const stripImages = guardrail({
      id: 'strip-images',
      on: boundary.input.media(),
      run: (subject) =>
        subject.part.type === 'image' ? { action: 'strip', reason: 'Images are not accepted.' } : { action: 'allow' },
    })
    const inspectLater = guardrail({
      id: 'inspect-after-strip',
      on: boundary.input.media(),
      run: (subject) => {
        seenLater.push(subject.part.type)
        return { action: 'allow' }
      },
    })
    const untouched = {
      role: 'assistant' as const,
      content: 'Prior response.',
    }
    const user = {
      role: 'user' as const,
      content: [{ type: 'text' as const, text: 'Review these.' }, image, file],
    }
    const messages = [untouched, user]
    const safety = createSafety({
      call: { guardrails: [stripImages, inspectLater] },
      promptId: 'prompt-1',
      model: 'model-1',
    })

    const result = await safety.guardInput({ messages })

    expect(result.messages).not.toBe(messages)
    expect(result.messages[0]).toBe(untouched)
    expect(result.messages[1]).not.toBe(user)
    expect(result.messages[1]?.content).toEqual([{ type: 'text', text: 'Review these.' }, file])
    expect(messages[1]).toBe(user)
    expect(user.content).toEqual([{ type: 'text', text: 'Review these.' }, image, file])
    expect(seenLater).toEqual(['file'])
  })

  it('projects text only after enforced media strips are applied', async () => {
    let projected = ''
    const stripFiles = guardrail({
      id: 'strip-files-before-text',
      on: boundary.input.media(),
      run: (subject) =>
        subject.part.type === 'file' ? { action: 'strip', reason: 'Files are not accepted.' } : { action: 'allow' },
    })
    const inspectText = guardrail({
      id: 'inspect-post-strip-text',
      on: boundary.input.text(),
      run: (subject) => {
        projected = subject
        return { action: 'allow' }
      },
    })
    const safety = createSafety({
      call: { guardrails: [stripFiles, inspectText] },
      promptId: 'prompt-1',
      model: 'model-1',
    })

    await safety.guardInput({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Keep this text.' },
            {
              type: 'file',
              source: 'https://example.com/report.pdf',
              mediaType: 'application/pdf',
            },
          ],
        },
      ],
    })

    expect(projected).toBe('Keep this text.')
  })

  it('immediately blocks when an enforcing strip would empty a media-only message', async () => {
    let laterCalls = 0
    const stripOnlyPart = guardrail({
      id: 'strip-only-part',
      on: boundary.input.media(),
      run: () => ({ action: 'strip', reason: 'The only part is disallowed.' }),
    })
    const later = guardrail({
      id: 'after-empty-strip',
      on: boundary.input.media(),
      run: () => {
        laterCalls++
        return { action: 'allow' }
      },
    })
    const safety = createSafety({
      call: { guardrails: [stripOnlyPart, later] },
      promptId: 'prompt-1',
      model: 'model-1',
    })

    const error = await safety
      .guardInput({
        messages: [
          { role: 'system', content: 'system' },
          {
            role: 'user',
            content: [{ type: 'image', source: 'https://example.com/chart.png' }],
          },
        ],
      })
      .then(() => undefined)
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(GuardrailBlockedError)
    expect((error as GuardrailBlockedError).decisions[0]).toMatchObject({
      policyId: 'strip-only-part',
      boundary: 'model.input.media',
      action: 'block',
      reason: 'The only part is disallowed.',
      location: {
        origin: { kind: 'message', messageIndex: 1, partIndex: 0 },
        partType: 'image',
      },
    })
    expect(safety.audit.guardrails?.applied).toContainEqual(
      expect.objectContaining({
        guard: 'strip-only-part',
        action: 'strip',
        reason: 'The only part is disallowed.',
        location: {
          origin: { kind: 'message', messageIndex: 1, partIndex: 0 },
          partType: 'image',
        },
        escalatedToBlock: true,
      }),
    )
    expect(laterCalls).toBe(0)
  })
})
