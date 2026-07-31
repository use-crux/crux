import type OpenAI from 'openai'
import type { GenerateObjectFn, GenerateTextFn } from '@use-crux/core'
import { openAIHelpers } from './native'

/**
 * Create a `GenerateObjectFn` that wraps an OpenAI client.
 *
 * The helper uses the same provider runtime as `createOpenAI()`, then
 * returns the schema-validated object expected by Crux scoring and retrieval
 * APIs. Pass a non-empty OpenAI model ID in every call. Provider SDK errors are
 * not caught or wrapped.
 *
 * @example
 * ```ts
 * const generateObject = createGenerateObjectFn(client)
 * const result = await generateObject({
 *   model: 'gpt-5-mini',
 *   prompt: 'Return whether this request is safe.',
 *   schema,
 * })
 * ```
 */
export function createGenerateObjectFn(client: OpenAI): GenerateObjectFn {
  const generateObject = openAIHelpers.createGenerateObjectFn(client)
  return async (options) => {
    try {
      return await generateObject(options)
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error('OpenAI returned no parsed output')
      }
      throw error
    }
  }
}

/**
 * Create a `GenerateTextFn` that wraps an OpenAI client.
 *
 * The helper shares request construction, response normalization, and provider
 * error behavior with the OpenAI provider runtime.
 */
export function createGenerateTextFn(client: OpenAI, model: string): GenerateTextFn {
  return openAIHelpers.createGenerateTextFn(client, model)
}
