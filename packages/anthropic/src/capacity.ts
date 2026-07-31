/**
 * Anthropic language-model capacity profiles.
 *
 * @module
 */

import type { ModelCapacityProfile } from '@use-crux/core/adapter'

const ANTHROPIC_CAPACITY = [
  ['claude-opus-4', 200_000, 64_000],
  ['claude-sonnet-4', 200_000, 64_000],
  ['claude-haiku-4', 200_000, 64_000],
  ['claude-3-7', 200_000, 64_000],
  ['claude-3-5', 200_000, 8_192],
  ['claude-3', 200_000, 4_096],
  ['claude-2.1', 200_000, 4_096],
  ['claude-2', 100_000, 4_096],
  ['claude-instant', 100_000, 4_096],
] as const

const ANTHROPIC_FALLBACK: ModelCapacityProfile = Object.freeze({
  contextWindow: 100_000,
  defaultOutputReserve: 8_192,
  countingConfidence: 'conservative',
})

/**
 * Report capacity facts for an Anthropic language model.
 *
 * Dated aliases inherit their model family's profile. Unknown identifiers use
 * a conservative provider fallback.
 *
 * @param model - Concrete provider model identifier.
 * @returns Capacity facts used for request-budget derivation.
 *
 * @example
 * ```ts
 * const profile = anthropicModelCapacity(modelId)
 * ```
 */
export function anthropicModelCapacity(model: string): ModelCapacityProfile {
  const match = ANTHROPIC_CAPACITY.find(([prefix]) => model.startsWith(prefix))
  if (!match) return ANTHROPIC_FALLBACK

  return Object.freeze({
    contextWindow: match[1],
    defaultOutputReserve: match[2],
    countingConfidence: 'estimated',
  })
}
