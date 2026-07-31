import type Anthropic from '@anthropic-ai/sdk'
import type { GenerateObjectFn, GenerateTextFn } from '@use-crux/core'
import { anthropicHelpers } from './native'

/**
 * Create a `GenerateObjectFn` that wraps an Anthropic client.
 *
 * The helper is generated from the same provider runtime as
 * `createAnthropic()`, using Anthropic's structured parse surface and
 * preserving provider SDK errors. Pass a non-empty Anthropic model ID in
 * every call.
 *
 * @example
 * ```ts
 * const generateObject = createGenerateObjectFn(client)
 * const result = await generateObject({
 *   model: 'claude-sonnet-4-5',
 *   prompt: 'Return whether this request is safe.',
 *   schema,
 * })
 * ```
 */
export function createGenerateObjectFn(client: Anthropic): GenerateObjectFn {
  const generateObject = anthropicHelpers.createGenerateObjectFn(client)
  return async (options) => {
    try {
      return await generateObject(options)
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error('Anthropic returned no parsed output')
      }
      throw error
    }
  }
}

/**
 * Create a `GenerateTextFn` that wraps an Anthropic client.
 *
 * Text helper calls share request construction and response extraction with
 * the Anthropic provider runtime.
 */
export function createGenerateTextFn(client: Anthropic, model: string): GenerateTextFn {
  return anthropicHelpers.createGenerateTextFn(client, model)
}
