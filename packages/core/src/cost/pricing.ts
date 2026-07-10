/**
 * Model pricing tables and USD cost estimation.
 *
 * {@link modelPricing} builds a {@link ModelPricing} lookup that tolerates
 * provider-prefixed (`openai/gpt-4o`) and version-suffixed (`gpt-4o:2024`)
 * model identifiers by progressively normalizing the key.
 *
 * @module
 */

import type { TokenUsage } from '../generation/types'
import type { ModelPrice, ModelPricing } from './types'

/**
 * Build a {@link ModelPricing} table from per-model unit prices.
 *
 * Lookups fall back from the exact key, to the provider-stripped key, to the
 * provider-stripped + version-stripped key, so callers can register prices
 * under canonical model names regardless of how the runtime labels them.
 *
 * @param prices - Map of model identifier to {@link ModelPrice}.
 * @returns A pricing table exposing `get()` and `estimate()`.
 *
 * @example
 * ```ts
 * const pricing = modelPricing({ 'gpt-4o': { input: 2.5, output: 10 } })
 * pricing.estimate('openai/gpt-4o', { inputTokens: 1000, outputTokens: 500 })
 * ```
 */
export function modelPricing(prices: Record<string, ModelPrice>): ModelPricing {
  const table = { ...prices }

  function get(model: string): ModelPrice | undefined {
    return table[model] ?? table[stripProvider(model)] ?? table[stripVersionSuffix(stripProvider(model))]
  }

  return {
    get,
    estimate(model, usage) {
      const price = get(model)
      if (!price) return undefined

      const input = usage.inputTokens ?? 0
      const output = usage.outputTokens ?? 0
      const cacheRead = usage.inputTokenDetails?.cacheReadTokens ?? 0
      const cacheWrite = usage.inputTokenDetails?.cacheWriteTokens ?? 0
      const reasoning = usage.outputTokenDetails?.reasoningTokens ?? 0
      return (
        (input * price.input +
          output * price.output +
          cacheRead * (price.cacheRead ?? price.input) +
          cacheWrite * (price.cacheWrite ?? price.input) +
          reasoning * (price.reasoning ?? price.output)) /
        1_000_000
      )
    },
  }
}

/** Drop a leading `provider/` prefix from a model identifier. */
function stripProvider(model: string): string {
  const slash = model.lastIndexOf('/')
  return slash === -1 ? model : model.slice(slash + 1)
}

/** Drop a trailing `:version` suffix from a model identifier. */
function stripVersionSuffix(model: string): string {
  const colon = model.indexOf(':')
  return colon === -1 ? model : model.slice(0, colon)
}
