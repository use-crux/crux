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
import type { RequestHistoryContext } from "../history/source";
import type { RequestWarning } from "../receipt/adaptations";
import type { RequestAdaptation } from "../receipt/adaptations";
import type { ResolvedRepresentationPolicy } from "../representation/ladder-types";
import type { RequestRepresentationEpoch } from "./epoch";
import { selectRepresentedRequest } from "./select";

const warnedExactHistory = new Set<string>();

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
  readonly history?: RequestHistoryContext;
  readonly representations?: readonly ResolvedRepresentationPolicy[];
  readonly representationEpoch?: RequestRepresentationEpoch;
  readonly prepareRequest?: (
    request: CallArgs<TExtra>,
    selections: ReadonlyMap<string, number>,
  ) => Promise<CallArgs<TExtra>>;
  readonly applyRepresentationSelection?: (
    selections: ReadonlyMap<string, number>,
  ) => void | Promise<void>;
}

/** Seal one exact request or fail before provider dispatch. @internal */
export async function sealRequest<
  TExtra extends Record<string, unknown>,
>(
  input: SealRequestInput<TExtra>,
): Promise<SealedRequestPlan<TExtra>> {
  const requestId = createRequestId();
  const profile = resolveModelCapacityProfile(input.model, input.capacity);
  let request = input.request;
  let estimate = estimateRequestTokens(request, {
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
  let adaptations: readonly RequestAdaptation[] = [];
  const policies = input.representations ?? [];
  if (policies.length > 0) {
    if (input.countTokens) {
      measurement = "exact";
      budget = deriveInputBudget({
        profile,
        settings: input.settings,
        inputBudget: input.inputBudget,
        measurement,
      });
    }
    const selected = await selectRepresentedRequest({
      provider: input.provider,
      model: input.model,
      requestId,
      request,
      policies,
      inputBudget: input.inputBudget,
      epoch: input.representationEpoch,
      media: input.media,
      countTokens: input.countTokens,
      prepareRequest: input.prepareRequest,
      optimizeAt: budget.optimizeAt,
      max: budget.max,
    });
    if (!selected) {
      throw tooLargeError(
        input,
        requestId,
        inputTokens,
        budget.max,
        estimate.breakdown,
      );
    }
    request = selected.request;
    await input.applyRepresentationSelection?.(selected.selections);
    inputTokens = selected.inputTokens;
    estimate = selected.estimate;
    adaptations = selected.adaptations;
  } else if (input.countTokens && inputTokens > budget.max) {
    inputTokens = assertAuthoritativeTokenCount(
      await input.countTokens(request),
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
  const warnings = requestWarnings(input, inputTokens, budget.optimizeAt);
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
    warnings,
    adaptations,
    ...(input.previousRequestId
      ? { previousRequestId: input.previousRequestId }
      : {}),
  });
  return requestPlan(request, receipt);
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
    ...(input.history?.policy === "exact"
      ? [
          {
            id: `${requestId}:history-remedy`,
            code: "HISTORY_EXACT_REMEDY",
            contributor: "history",
            message:
              "Keep canonical history exact and configure history.recent() for a stateless window or history() for managed adaptation.",
          },
        ]
      : []),
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

function requestWarnings<TExtra extends Record<string, unknown>>(
  input: SealRequestInput<TExtra>,
  inputTokens: number,
  optimizeAt: number,
): readonly RequestWarning[] {
  const warnings = [...(input.history?.warnings ?? [])];
  if (
    input.history?.policy !== "exact" ||
    inputTokens <= optimizeAt
  ) {
    return warnings;
  }
  warnings.push({
    code: "HISTORY_EXACT_NEAR_LIMIT",
    message:
      "Complete exact history crossed the request optimization watermark and may eventually stop fitting; configure history.recent() or history().",
  });
  const warningKey = `${input.provider}:${input.model}`;
  if (
    !warnedExactHistory.has(warningKey) &&
    (typeof process === "undefined" ||
      process.env.NODE_ENV !== "production")
  ) {
    warnedExactHistory.add(warningKey);
    console.warn(
      `[Crux] Complete exact history for ${input.provider}/${input.model} crossed its request optimization watermark. Configure history.recent() or history() before it stops fitting.`,
    );
  }
  return warnings;
}
