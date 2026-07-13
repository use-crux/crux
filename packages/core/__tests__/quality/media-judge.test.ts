import { describe, expect, it, vi } from 'vitest'
import { scorers } from '../../src/quality'
import type { GenerateFn } from '../../src/quality'

describe('multimodal judge content', () => {
  it('sends an Asset as ordinary canonical message content', async () => {
    const generate = vi.fn(async (judgePrompt: never) => {
      const authored = judgePrompt as unknown as { config: { messages: () => unknown[] } }
      const messages = authored.config.messages()
      expect(messages).toMatchObject([{ role: 'user', content: [
        { type: 'text', text: expect.stringContaining('Is the chart legible?') },
        { type: 'image', mediaType: 'image/png', source: { type: 'data' } },
      ] }])
      return { object: { reasoning: 'legible', score: 0.9 } }
    }) as GenerateFn
    const scorer = scorers.judge({
      name: 'legible', rubric: 'Is the chart legible?', generate, model: 'vision-model',
    })
    const output = { type: 'data' as const, data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }

    await expect(scorer({ input: 'chart', output, expected: undefined })).resolves.toMatchObject({
      name: 'legible', score: 0.9, metadata: { rationale: 'legible' },
    })
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('rejects uncaptured structured evidence instead of stringifying it', async () => {
    const scorer = scorers.judge<'judge', { answer: string }>({
      name: 'judge', rubric: 'good?', select: (() => ({ answer: 'not content' })) as never,
      generate: vi.fn() as GenerateFn, model: 'm',
    })
    expect(() => scorer({ input: 'x', output: { answer: 'x' }, expected: undefined })).toThrow(/must return string, Asset/)
  })
})
