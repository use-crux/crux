/**
 * Provider adaptation and generation setting merge helpers.
 *
 * The prompt compiler stays provider-neutral: adaptation is selected from
 * prompt-owned data and merged with call-site settings using simple
 * last-write-wins semantics.
 *
 * @module
 */

import type { ModelInfo } from '../types'
import type { AdapterMap, GenerationSettings, PromptAdaptation } from '../generation/types'

/** Select the provider/model adaptation block that applies to a call. */
export function selectAdaptation(adapt: AdapterMap | undefined, modelInfo: ModelInfo): PromptAdaptation | undefined {
  if (!adapt) return undefined
  const { provider, modelId } = modelInfo

  if (provider && adapt[provider]) {
    return adapt[provider]
  }

  const slashIdx = modelId.indexOf('/')
  if (slashIdx > 0) {
    const prefix = modelId.slice(0, slashIdx)
    if (adapt[prefix]) {
      return adapt[prefix]
    }
  }

  return adapt['*']
}

/**
 * Merge generation settings with last-write-wins semantics.
 *
 * Only explicitly set fields are applied, so `undefined` never erases an
 * earlier config or adaptation value.
 */
export function mergeSettings(...sources: (GenerationSettings | undefined)[]): GenerationSettings {
  const result: Record<string, unknown> = {}
  for (const source of sources) {
    if (!source) continue
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined) result[key] = value
    }
  }
  return result as GenerationSettings
}
