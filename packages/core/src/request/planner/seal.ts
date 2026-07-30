/**
 * Measure, validate, and seal one exact provider request.
 *
 * @module
 */

import type { CallArgs } from "../../adapter/types";
import type { ProviderMediaHooks } from "../../adapter/native-chat/media-hooks";
import type { GenerationSettings } from "../../generation/types";
import {
  resolveModelCapacityProfile,
  type ModelCapacityResolver,
  type ModelCountingConfidence,
} from "../capacity/model-profile";
import type { InputBudget } from "../budget/input-budget";
import { deriveInputBudget } from "../budget/derive";
import {
  RequestCompositionError,
  type RequestDiagnostic,
} from "../errors";
import {
  assertAuthoritativeTokenCount,
  type RequestTokenCounter,
} from "../measure/counter-port";
import { estimateRequestTokens } from "../measure/estimate";
import { withTokenBreakdownTotal } from "../measure/breakdown";
import {
  createRequestId,
  createRequestReceipt,
} from "../receipt/receipt";
import { requestPlan, type SealedRequestPlan } from "./plan";

/** Inputs required to seal one exact request. @internal */
export interface SealRequestInput<
  TExtra extends Record<string, unknown>,
> {
  readonly provider: string;
  readonly model: string;
  readonly request: CallArgs<TExtra>;
  readonly settings: GenerationSettings;
  readonly inputBudget?: InputBudget;
  readonly capacity?: ModelCapacityResolver;
  readonly countTokens?: RequestTokenCounter<TExtra>;
  readonly media?: ProviderMediaHooks;
  readonly previousRequestId?: string;
}

/** Seal one exact request or fail before provider dispatch. @internal */
export async function sealRequest<
  TExtra extends Record<string, unknown>,
>(
  input: SealRequestInput<TExtra>,
): Promise<SealedRequestPlan<TExtra>> {
  const requestId = createRequestId();
  const profile = resolveModelCapacityProfile(input.model, input.capacity);
  const estimate = estimateRequestTokens(input.request, {
    provider: input.provider,
    ...(input.media ? { media: input.media } : {}),
  });
  let inputTokens = estimate.inputTokens;
  let measurement: ModelCountingConfidence = profile.countingConfidence;
  let budget = deriveInputBudget({
    profile,
    settings: input.settings,
    inputBudget: input.inputBudget,
    measurement,
  });
  if (input.countTokens && inputTokens > budget.max) {
    inputTokens = assertAuthoritativeTokenCount(
      await input.countTokens(input.request),
    );
    measurement = "exact";
    budget = deriveInputBudget({
      profile,
      settings: input.settings,
      inputBudget: input.inputBudget,
      measurement,
    });
  }
  const breakdown = withTokenBreakdownTotal(
    estimate.breakdown,
    inputTokens,
  );
  if (inputTokens > budget.max) {
    throw tooLargeError(
      input,
      requestId,
      inputTokens,
      budget.max,
      breakdown,
    );
  }
  const receipt = createRequestReceipt({
    id: requestId,
    model: input.model,
    inputTokens,
    maxInputTokens: budget.max,
    measurement,
    breakdown,
    safetyMarginTokens: budget.safetyMargin,
    providerOverheadTokens: budget.providerOverhead,
    ...(input.previousRequestId
      ? { previousRequestId: input.previousRequestId }
      : {}),
  });
  return requestPlan(input.request, receipt);
}

function tooLargeError<TExtra extends Record<string, unknown>>(
  input: SealRequestInput<TExtra>,
  requestId: string,
  inputTokens: number,
  maxInputTokens: number,
  breakdown: ReturnType<typeof estimateRequestTokens>["breakdown"],
): RequestCompositionError {
  const largest = breakdown.contributions.slice(0, 3);
  const diagnostics: RequestDiagnostic[] = [
    {
      id: `${requestId}:input-limit`,
      code: "REQUEST_INPUT_LIMIT",
      tokens: inputTokens,
      message: `Minimum required input is ${inputTokens} tokens; ${maxInputTokens} are available.`,
    },
    ...largest.map((entry, index) => ({
      id: `${requestId}:contributor:${index + 1}`,
      code: "LARGEST_REQUIRED_CONTRIBUTOR",
      contributor: entry.contributor,
      tokens: entry.tokens,
      message: `${entry.contributor} contributes approximately ${entry.tokens} tokens.`,
    })),
    {
      id: `${requestId}:alternatives`,
      code: "EXACT_REPRESENTATION_EXHAUSTED",
      message:
        "The exact representation is the only authorized representation and does not fit.",
    },
    {
      id: `${requestId}:remedy`,
      code: "REQUEST_REMEDY",
      message:
        "Increase inputBudget.max, reduce exact input, reserve fewer output tokens, or authorize a lower representation.",
    },
  ];
  const names = largest.map((entry) => entry.contributor).join(", ") || "none";
  return new RequestCompositionError(
    "REQUEST_TOO_LARGE",
    `Request "${requestId}" for model "${input.model}" requires ${inputTokens} input tokens but only ${maxInputTokens} are available. Largest required contributors: ${names}. Exact representation exhausted.`,
    diagnostics,
    requestId,
  );
}
