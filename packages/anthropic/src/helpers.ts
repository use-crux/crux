import type Anthropic from '@anthropic-ai/sdk'
import type { GenerateObjectFn, GenerateTextFn } from '@use-crux/core/compaction'
import { anthropicHelpers } from './native'

/**
 * Create a `GenerateObjectFn` that wraps an Anthropic client.
 *
 * The helper is generated from the same provider runtime as
 * `createAnthropic()`, using Anthropic's structured parse surface and
 * preserving provider SDK errors.
 */
export function createGenerateObjectFn(client: Anthropic, model: string): GenerateObjectFn {
  const generateObject = anthropicHelpers.createGenerateObjectFn(client, model)
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
