import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createGenerateObjectFnFromGenerate } from '../../src/compaction'
import type { Message } from '../../src/generation/messages'

interface ResolvablePrompt {
  readonly _tag: 'Prompt'
  readonly id: string | undefined
  readonly outputSchema: unknown
  resolve(opts: Record<string, unknown>): Promise<{
    readonly system?: string
    readonly prompt?: string
    readonly messages?: Message[]
    readonly schema?: unknown
  }>
}

function isResolvablePrompt(value: unknown): value is ResolvablePrompt {
  return (
    value !== null &&
    typeof value === 'object' &&
    '_tag' in value &&
    value._tag === 'Prompt' &&
    'resolve' in value &&
    typeof value.resolve === 'function'
  )
}

describe('createGenerateObjectFnFromGenerate', () => {
  it('calls adapter generate with a synthetic structured prompt and unwraps result.object', async () => {
    const schema = z.object({ answer: z.string() })
    const expected = { answer: 'adapter backed' }
    const model = { provider: 'test', modelId: 'structured' }
    let resolved:
      | {
          readonly system?: string
          readonly prompt?: string
          readonly messages?: Message[]
          readonly schema?: unknown
        }
      | undefined
    let capturedOptions: unknown

    const generate = vi.fn(async (syntheticPrompt: unknown, options: unknown): Promise<unknown> => {
      if (!isResolvablePrompt(syntheticPrompt)) {
        throw new TypeError('Expected a Crux prompt')
      }

      expect(syntheticPrompt.id).toBe('test.generate-object')
      expect(syntheticPrompt.outputSchema).toBe(schema)
      resolved = await syntheticPrompt.resolve({})
      capturedOptions = options

      return { object: expected }
    })

    const generateObject = createGenerateObjectFnFromGenerate(generate, {
      promptId: 'test.generate-object',
    })

    const result = await generateObject({
      model,
      system: 'Return a concise answer.',
      prompt: 'What backs this helper?',
      schema,
      temperature: 0.2,
      topP: 0.9,
    })

    expect(result.object).toEqual(expected)
    expect(resolved).toMatchObject({
      system: 'Return a concise answer.',
      prompt: 'What backs this helper?',
      schema,
    })
    expect(capturedOptions).toEqual({ model, input: {}, temperature: 0.2, topP: 0.9 })
    expect(generate).toHaveBeenCalledOnce()
  })

  it('preserves canonical messages and media without flattening them', async () => {
    const schema = z.object({ safe: z.boolean() })
    const image = new Uint8Array([1, 2, 3])
    const file = new Uint8Array([4, 5, 6])
    const messages = [
      { role: 'system', content: 'Existing system context.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Inspect these parts.' },
          { type: 'image', source: image, mediaType: 'image/png' },
          {
            type: 'file',
            source: file,
            mediaType: 'application/pdf',
            filename: 'report.pdf',
          },
        ],
      },
    ] as const satisfies readonly Message[]
    let resolvedMessages: Message[] | undefined

    const generate = vi.fn(async (syntheticPrompt: unknown): Promise<unknown> => {
      if (!isResolvablePrompt(syntheticPrompt)) {
        throw new TypeError('Expected a Crux prompt')
      }
      resolvedMessages = (await syntheticPrompt.resolve({})).messages
      return { object: { safe: true } }
    })

    const generateObject = createGenerateObjectFnFromGenerate(generate)
    await generateObject({ model: 'classifier', messages, schema })

    expect(resolvedMessages).toEqual(messages)
    expect(resolvedMessages).not.toBe(messages)
  })

  it('folds common system text into canonical messages', async () => {
    const schema = z.object({ safe: z.boolean() })
    let resolvedMessages: Message[] | undefined

    const generate = vi.fn(async (syntheticPrompt: unknown): Promise<unknown> => {
      if (!isResolvablePrompt(syntheticPrompt)) {
        throw new TypeError('Expected a Crux prompt')
      }
      resolvedMessages = (await syntheticPrompt.resolve({})).messages
      return { object: { safe: true } }
    })

    const generateObject = createGenerateObjectFnFromGenerate(generate)
    await generateObject({
      model: 'classifier',
      system: 'Classifier system.',
      messages: [
        { role: 'system', content: 'Existing system.' },
        { role: 'user', content: 'Inspect this.' },
      ],
      schema,
    })

    expect(resolvedMessages).toEqual([
      { role: 'system', content: 'Classifier system.\n\nExisting system.' },
      { role: 'user', content: 'Inspect this.' },
    ])
  })

  it('rejects adapter results without a structured object', async () => {
    const generateObject = createGenerateObjectFnFromGenerate(async () => ({ text: 'not structured' }))

    await expect(
      generateObject({
        model: 'classifier',
        prompt: 'Return an object.',
        schema: z.object({ safe: z.boolean() }),
      }),
    ).rejects.toThrow(new TypeError('Adapter generate returned no `object` for the structured prompt.'))
  })
})
