/**
 * Structured fact extraction from conversation messages.
 *
 * Uses LLM structured output to extract typed facts defined by a Zod schema.
 * Stateless — no side effects, no automatic storage.
 *
 * @module
 */

import type { z } from 'zod'
import type { ExtractConfig } from './types'
import { formatTranscript } from './summarize'

/**
 * Extract structured facts from a message array using LLM structured output.
 *
 * @param config - Extraction configuration including messages, generate fn, model, and schema.
 * @returns Typed result matching the provided Zod schema.
 */
export async function extractKeyFacts<T extends z.ZodType>(config: ExtractConfig<T>): Promise<z.infer<T>> {
  const { messages, generate, model, schema } = config

  const transcript = formatTranscript(messages)

  const system = [
    'You are an information extraction system.',
    'Analyze the conversation below and extract structured facts.',
    'Only extract information that is explicitly stated or clearly implied in the conversation.',
    'Do not infer or add information that is not supported by the text.',
  ].join(' ')

  const { object } = await generate({
    model,
    system,
    prompt: transcript,
    schema,
  })

  return object as z.infer<T>
}
