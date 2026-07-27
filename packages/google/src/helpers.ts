import type { GoogleGenAI } from '@google/genai'
import type { GenerateObjectFn, GenerateTextFn } from '@use-crux/core/compaction'
import { googleHelpers } from './native'

/**
 * Create a `GenerateObjectFn` that wraps a Google GenAI client.
 *
 * The helper is generated from the same provider runtime as
 * `createGoogle()`, sends the supplied schema to Google structured JSON
 * output, and preserves provider SDK errors. Pass a non-empty Google model ID
 * in every call.
 *
 * @example
 * ```ts
 * const generateObject = createGenerateObjectFn(client)
 * const result = await generateObject({
 *   model: 'gemini-2.5-flash',
 *   prompt: 'Return whether this request is safe.',
 *   schema,
 * })
 * ```
 */
export function createGenerateObjectFn(client: GoogleGenAI): GenerateObjectFn {
  return googleHelpers.createGenerateObjectFn(client)
}

/**
 * Create a `GenerateTextFn` that wraps a Google GenAI client.
 *
 * Text helper calls share request construction and response extraction with
 * the Google provider runtime.
 */
export function createGenerateTextFn(client: GoogleGenAI, model: string): GenerateTextFn {
  return googleHelpers.createGenerateTextFn(client, model)
}
