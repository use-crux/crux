/**
 * Eval-local model bindings for the Node basic Quality examples.
 *
 * @module
 */

import { openai } from '@ai-sdk/openai'
import { generate } from '@crux/ai'
import type { GenerateFn, ModelRef } from '@crux/core/quality'

/**
 * Model providers used by model-backed Quality examples.
 *
 * Keeping this small helper next to the eval makes the model choice visible
 * in source and keeps local tooling free from duplicate config registration.
 * Use project-level `quality.setup()` only when a project intentionally wants
 * a compatibility default shared by many evaluations.
 */
export interface QualityModelRuntime {
  /** Adapter generate function used by model-backed tasks. */
  readonly generate: GenerateFn
  /** Default model for task execution. */
  readonly model: ModelRef
  /** Default model for judge scorers. */
  readonly judgeModel: ModelRef
}

/**
 * Create a Vercel AI SDK-backed Quality runtime for one eval file.
 *
 * @param modelId - OpenAI model id passed to `@ai-sdk/openai`.
 * @returns The adapter function and model refs accepted by Quality targets.
 */
export function createQualityModelRuntime(modelId = 'gpt-4o-mini'): QualityModelRuntime {
  const model = openai(modelId)

  return {
    generate,
    model,
    judgeModel: model,
  } satisfies QualityModelRuntime
}
