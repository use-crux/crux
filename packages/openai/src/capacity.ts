/**
 * OpenAI language-model capacity profiles.
 *
 * @module
 */

import type { ModelCapacityProfile } from "@use-crux/core/adapter";

const ESTIMATED = "estimated" as const;

const OPENAI_CAPACITY = [
  ["gpt-5", 400_000, 128_000],
  ["gpt-4.1", 1_047_576, 32_768],
  ["gpt-4o", 128_000, 16_384],
  ["gpt-4-turbo", 128_000, 4_096],
  ["gpt-4", 8_192, 4_096],
  ["gpt-3.5-turbo", 16_385, 4_096],
  ["o1", 200_000, 100_000],
  ["o3", 200_000, 100_000],
  ["o4", 200_000, 100_000],
] as const;

const OPENAI_FALLBACK: ModelCapacityProfile = Object.freeze({
  contextWindow: 16_384,
  defaultOutputReserve: 4_096,
  countingConfidence: "conservative",
});

/**
 * Report capacity facts for an OpenAI language model.
 *
 * Dated aliases inherit their model family's profile. Unknown identifiers use
 * a deliberately small provider fallback and are never treated optimistically.
 *
 * @param model - Concrete OpenAI model identifier.
 * @returns Capacity facts used for request-budget derivation.
 *
 * @example
 * ```ts
 * const profile = openAIModelCapacity('gpt-4o')
 * ```
 */
export function openAIModelCapacity(model: string): ModelCapacityProfile {
  const match = OPENAI_CAPACITY.find(([prefix]) => model.startsWith(prefix));
  if (!match) return OPENAI_FALLBACK;

  return Object.freeze({
    contextWindow: match[1],
    defaultOutputReserve: match[2],
    countingConfidence: ESTIMATED,
  });
}
