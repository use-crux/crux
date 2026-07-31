/**
 * Effective model input limits derived from capacity and call settings.
 *
 * @module
 */

import type { GenerationSettings } from "../../generation/types";
import type {
  ModelCapacityProfile,
  ModelCountingConfidence,
} from "../capacity/model-profile";
import type { InputBudget } from "./input-budget";
import { validateInputBudget } from "./input-budget";

/** Conservative provider framing allowance reserved outside measured content. */
export const PROVIDER_REQUEST_OVERHEAD_TOKENS = 32;

/** Fully derived limits used to select one request candidate. @internal */
export interface DerivedInputBudget {
  /** Strict measured-content limit after all reserves. */
  readonly max: number;
  /** Soft optimization watermark, clamped to the strict maximum. */
  readonly optimizeAt: number;
  /** Lower watermark used later to prevent representation oscillation. */
  readonly resetAt: number;
  /** Output allowance reserved from the model context window. */
  readonly outputReserve: number;
  /** Provider framing allowance reserved from the context window. */
  readonly providerOverhead: number;
  /** Confidence-based counting safety margin. */
  readonly safetyMargin: number;
}

/** Derive the effective per-call input budget. @internal */
export function deriveInputBudget(input: {
  readonly profile: ModelCapacityProfile;
  readonly settings: GenerationSettings;
  readonly inputBudget?: InputBudget;
  readonly measurement: ModelCountingConfidence;
}): DerivedInputBudget {
  if (input.inputBudget) validateInputBudget(input.inputBudget);
  const outputReserve =
    input.settings.maxTokens ?? input.profile.defaultOutputReserve;
  const safetyMargin = countingSafetyMargin(
    input.profile.contextWindow,
    input.measurement,
  );
  const capacityMax = Math.max(
    0,
    input.profile.contextWindow -
      outputReserve -
      PROVIDER_REQUEST_OVERHEAD_TOKENS -
      safetyMargin,
  );
  const max = Math.min(input.inputBudget?.max ?? capacityMax, capacityMax);
  const optimizeAt = Math.min(input.inputBudget?.optimizeAt ?? max, max);
  return Object.freeze({
    max,
    optimizeAt,
    resetAt: Math.floor(optimizeAt * 0.9),
    outputReserve,
    providerOverhead: PROVIDER_REQUEST_OVERHEAD_TOKENS,
    safetyMargin,
  });
}

function countingSafetyMargin(
  contextWindow: number,
  measurement: ModelCountingConfidence,
): number {
  if (measurement === "exact") return 0;
  const ratio = measurement === "estimated" ? 0.05 : 0.1;
  return Math.ceil(contextWindow * ratio);
}
