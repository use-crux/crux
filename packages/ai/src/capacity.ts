/**
 * Capacity profiles for language models routed through the AI SDK.
 *
 * @module
 */

import {
  CONSERVATIVE_MODEL_CAPACITY,
  type ModelCapacityProfile,
} from "@use-crux/core/adapter";
import type { ModelInfo } from "@use-crux/core";

const AI_SDK_CAPACITY = [
  ["gpt-5", 400_000, 128_000],
  ["gpt-4.1", 1_047_576, 32_768],
  ["gpt-4o", 128_000, 16_384],
  ["gpt-4-turbo", 128_000, 4_096],
  ["gpt-4", 8_192, 4_096],
  ["gpt-3.5-turbo", 16_385, 4_096],
  ["o1", 200_000, 100_000],
  ["o3", 200_000, 100_000],
  ["o4", 200_000, 100_000],
  ["claude-opus-4", 200_000, 64_000],
  ["claude-sonnet-4", 200_000, 64_000],
  ["claude-haiku-4", 200_000, 64_000],
  ["claude-3-7", 200_000, 64_000],
  ["claude-3-5", 200_000, 8_192],
  ["claude-3", 200_000, 4_096],
  ["claude-2.1", 200_000, 4_096],
  ["claude-2", 100_000, 4_096],
  ["claude-instant", 100_000, 4_096],
  ["gemini-3", 1_048_576, 65_536],
  ["gemini-2.5", 1_048_576, 65_536],
  ["gemini-2.0", 1_048_576, 8_192],
  ["gemini-1.5-pro", 2_097_152, 8_192],
  ["gemini-1.5-flash", 1_048_576, 8_192],
] as const;

/**
 * Report capacity facts for a language model routed through the AI SDK.
 *
 * Known model families receive provider-specific profiles. Models from custom
 * or future providers use core's conservative fallback.
 *
 * @param model - Provider and model identity extracted by the adapter.
 * @returns Capacity facts used for request-budget derivation.
 *
 * @example
 * ```ts
 * const profile = aiSdkModelCapacity({ provider, modelId });
 * ```
 */
export function aiSdkModelCapacity(
  model: ModelInfo,
): ModelCapacityProfile {
  const match = AI_SDK_CAPACITY.find(([prefix]) =>
    model.modelId.startsWith(prefix),
  );
  if (!match) return CONSERVATIVE_MODEL_CAPACITY;

  return Object.freeze({
    contextWindow: match[1],
    defaultOutputReserve: match[2],
    countingConfidence: "estimated",
  });
}
