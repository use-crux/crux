/**
 * Google language-model capacity profiles.
 *
 * @module
 */

import type { ModelCapacityProfile } from "@use-crux/core/adapter";

const GOOGLE_CAPACITY = [
  ["gemini-3", 1_048_576, 65_536],
  ["gemini-2.5", 1_048_576, 65_536],
  ["gemini-2.0", 1_048_576, 8_192],
  ["gemini-1.5-pro", 2_097_152, 8_192],
  ["gemini-1.5-flash", 1_048_576, 8_192],
] as const;

const GOOGLE_FALLBACK: ModelCapacityProfile = Object.freeze({
  contextWindow: 32_768,
  defaultOutputReserve: 8_192,
  countingConfidence: "conservative",
});

/**
 * Report capacity facts for a Google language model.
 *
 * Versioned aliases inherit their model family's profile. Unknown identifiers
 * use a conservative provider fallback.
 *
 * @param model - Concrete provider model identifier.
 * @returns Capacity facts used for request-budget derivation.
 *
 * @example
 * ```ts
 * const profile = googleModelCapacity(modelId);
 * ```
 */
export function googleModelCapacity(model: string): ModelCapacityProfile {
  const match = GOOGLE_CAPACITY.find(([prefix]) => model.startsWith(prefix));
  if (!match) return GOOGLE_FALLBACK;

  return Object.freeze({
    contextWindow: match[1],
    defaultOutputReserve: match[2],
    countingConfidence: "estimated",
  });
}
