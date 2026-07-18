/**
 * Adapter-backed structured generation helpers.
 *
 * @module
 */

import { z } from 'zod'
import { prompt } from '../prompt/prompt'
import type { GenerateObjectFn } from './types'

const DEFAULT_PROMPT_ID = 'crux.generateObject'

interface GenerateObjectOptions<T> {
  readonly model: unknown
  readonly system?: string
  readonly prompt: string
  readonly schema: z.ZodType<T>
  readonly temperature?: number
  readonly topP?: number
}

interface GenerateObjectResult<T> {
  readonly object: T
}

interface ObjectResultLike {
  readonly object: unknown
}

interface AdapterGenerateOptions {
  readonly model: unknown
  readonly input: Record<string, never>
  readonly temperature?: number
  readonly topP?: number
}

/**
 * Adapter `generate()` shape accepted by {@link createGenerateObjectFnFromGenerate}.
 *
 * Adapter packages narrow their prompt and option types differently, so this
 * bridge uses `never` parameters to remain assignable from any concrete
 * adapter `generate` function under `strictFunctionTypes`. The helper creates
 * the prompt and options internally, then forwards them opaquely.
 */
export type GenerateObjectAdapterGenerateFn = (prompt: never, options: never) => Promise<unknown>

/**
 * Options for {@link createGenerateObjectFnFromGenerate}.
 */
export interface GenerateObjectBridgeOptions {
  /**
   * Prompt id used for the synthetic structured prompt.
   *
   * This id can appear in traces, Eval evidence, and adapter hooks. Defaults to
   * `crux.generateObject`.
   */
  readonly promptId?: string
}

/**
 * Create a {@link GenerateObjectFn} from an adapter `generate()` function.
 *
 * Use this when a Crux primitive expects the portable `GenerateObjectFn`
 * contract, but your application already has an adapter-backed `generate`
 * function from `@use-crux/ai` or another adapter. The bridge builds a temporary
 * structured prompt with the provided system text, user prompt, and Zod schema,
 * executes the adapter, and returns the adapter's `result.object`. Validation
 * remains the adapter's responsibility, just as it is for normal structured
 * prompt execution.
 *
 * @param generate - Adapter `generate()` function to execute the synthetic prompt.
 * @param options - Optional bridge configuration.
 * @returns A framework-agnostic structured generation function.
 *
 * @example
 * ```ts
 * import { createGenerateObjectFnFromGenerate } from '@use-crux/core/compaction'
 * import { generate } from '@use-crux/ai'
 *
 * const generateObject = createGenerateObjectFnFromGenerate(generate)
 * const result = await generateObject({ model, prompt: 'Grade this', schema })
 * ```
 */
export function createGenerateObjectFnFromGenerate(
  generate: GenerateObjectAdapterGenerateFn,
  options: GenerateObjectBridgeOptions = {},
): GenerateObjectFn {
  return async <T>(generateOptions: GenerateObjectOptions<T>): Promise<GenerateObjectResult<T>> => {
    const structuredPrompt = prompt({
      id: options.promptId ?? DEFAULT_PROMPT_ID,
      input: z.object({}),
      output: generateOptions.schema,
      ...(generateOptions.system !== undefined ? { system: generateOptions.system } : {}),
      prompt: generateOptions.prompt,
    })

    const adapterOptions = {
      model: generateOptions.model,
      input: {},
      ...(generateOptions.temperature !== undefined ? { temperature: generateOptions.temperature } : {}),
      ...(generateOptions.topP !== undefined ? { topP: generateOptions.topP } : {}),
    } satisfies AdapterGenerateOptions

    const result = await generate(structuredPrompt as never, adapterOptions as never)
    if (!isObjectResultLike(result)) {
      throw new TypeError('Adapter generate returned no `object` for the structured prompt.')
    }

    return { object: result.object as T }
  }
}

function isObjectResultLike(value: unknown): value is ObjectResultLike {
  return value !== null && typeof value === 'object' && 'object' in value
}
