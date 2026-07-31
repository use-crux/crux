/**
 * Provider-neutral model capacity profiles and conservative resolution.
 *
 * @module
 */

/**
 * Confidence of the token measurement available for a model request.
 *
 * @example
 * ```ts
 * const confidence: ModelCountingConfidence = "estimated";
 * ```
 */
export type ModelCountingConfidence =
  | "exact"
  | "estimated"
  | "conservative";

/**
 * Capacity facts needed to derive a safe whole-request input budget.
 *
 * A profile describes one model family. It never changes the caller's output
 * setting or performs provider I/O.
 *
 * @example
 * ```ts
 * const profile: ModelCapacityProfile = {
 *   contextWindow: 128_000,
 *   defaultOutputReserve: 16_384,
 *   countingConfidence: 'estimated',
 * };
 * ```
 */
export interface ModelCapacityProfile {
  /** Maximum combined input and output tokens accepted by the model. */
  readonly contextWindow: number;
  /** Output tokens reserved when the caller did not provide a maximum. */
  readonly defaultOutputReserve: number;
  /** Confidence available when measuring requests for this model. */
  readonly countingConfidence: ModelCountingConfidence;
}

/**
 * Resolve capacity facts for a provider model.
 *
 * Returning `undefined` delegates to core's conservative fallback. The
 * resolver must be synchronous and side-effect free; token-counting I/O uses
 * the separate adapter counting port.
 *
 * @param model - Concrete provider model identifier.
 * @returns Capacity facts for the model, or `undefined` when it is unknown.
 *
 * @example
 * ```ts
 * const capacity: ModelCapacityResolver = (model) =>
 *   model === "known-model" ? profile : undefined;
 * ```
 */
export type ModelCapacityResolver = (
  model: string,
) => ModelCapacityProfile | undefined;

/**
 * Provider-neutral fallback used when no adapter profile is available.
 *
 * The deliberately small window prevents an unknown model from inheriting an
 * optimistic allowance. Adapters can provide a different conservative
 * fallback through their capacity resolver.
 *
 * @example
 * ```ts
 * const strictInputLimit =
 *   CONSERVATIVE_MODEL_CAPACITY.contextWindow -
 *   CONSERVATIVE_MODEL_CAPACITY.defaultOutputReserve;
 * ```
 */
export const CONSERVATIVE_MODEL_CAPACITY: ModelCapacityProfile = Object.freeze({
  contextWindow: 8_192,
  defaultOutputReserve: 2_048,
  countingConfidence: "conservative",
});

/**
 * Resolve one model profile without provider I/O.
 *
 * @param model - Concrete provider model identifier.
 * @param capacity - Optional adapter-owned resolver.
 * @returns The adapter profile or core's frozen conservative fallback.
 *
 * @example
 * ```ts
 * const profile = resolveModelCapacityProfile("future-model", capacity);
 * ```
 */
export function resolveModelCapacityProfile(
  model: string,
  capacity?: ModelCapacityResolver,
): ModelCapacityProfile {
  return capacity?.(model) ?? CONSERVATIVE_MODEL_CAPACITY;
}
