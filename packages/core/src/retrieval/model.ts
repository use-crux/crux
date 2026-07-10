/**
 * Provider-agnostic model contract for LLM-powered retrieval steps.
 *
 * Adapter packages bind provider SDK models into this interface. Core accepts
 * the bound generator surface, never raw provider model objects.
 *
 * @module
 */

import type { z } from 'zod'
import type { GenerateObjectFn, GenerateTextFn } from '../compaction/types'

/** Bound text/object generation contract used by retrieval steps. */
export interface RetrievalModel {
  generateText(args: Omit<Parameters<GenerateTextFn>[0], 'model'>): ReturnType<GenerateTextFn>
  generateObject<T>(
    args: Omit<Parameters<GenerateObjectFn>[0], 'model' | 'schema'> & { schema: z.ZodType<T> },
  ): Promise<{ object: T }>
}
