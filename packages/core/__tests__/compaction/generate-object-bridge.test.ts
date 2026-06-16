import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createGenerateObjectFnFromGenerate } from '../../compaction'

interface ResolvablePrompt {
  readonly _tag: 'Prompt'
  readonly id: string | undefined
  readonly outputSchema: unknown
  resolve(opts: Record<string, unknown>): Promise<{
    readonly system?: string
    readonly prompt?: string
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
    })

    expect(result.object).toEqual(expected)
    expect(resolved).toMatchObject({
      system: 'Return a concise answer.',
      prompt: 'What backs this helper?',
      schema,
    })
    expect(capturedOptions).toEqual({ model, input: {} })
    expect(generate).toHaveBeenCalledOnce()
  })
})
