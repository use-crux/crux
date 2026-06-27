import type OpenAI from 'openai'
import type { GenerateObjectFn, GenerateTextFn } from '@use-crux/core/compaction'
import { openAIHelpers } from './native'

/**
 * Create a `GenerateObjectFn` that wraps an OpenAI client.
 *
 * The helper uses the same provider runtime as `createOpenAI()`, then
 * returns the schema-validated object expected by Crux compaction and scoring
 * APIs. Provider SDK errors are not caught or wrapped.
 */
export function createGenerateObjectFn(client: OpenAI, model: string): GenerateObjectFn {
  const generateObject = openAIHelpers.createGenerateObjectFn(client, model)
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
