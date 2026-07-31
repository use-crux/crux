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
import type { GenerateHistorySummary } from "../artifacts/lifecycle";
import { resolveManagedHistoryPolicy } from "../history/managed-policy";
import { prepareRepresentationPolicies } from "../representation/prepare";
import { requestWarnings, tooLargeError } from "./diagnostics";

/** Inputs required to seal one exact request. @internal */
export interface SealRequestInput<
  TExtra extends Record<string, unknown>,
> {
  readonly provider: string;
  readonly model: string;
  readonly responseModel?: unknown;
  readonly request: CallArgs<TExtra>;
  readonly settings: GenerationSettings;
  readonly inputBudget?: InputBudget;
  readonly capacity?: ModelCapacityResolver;
  readonly countTokens?: RequestTokenCounter<TExtra>;
  readonly media?: ProviderMediaHooks;
  readonly previousRequestId?: string;
  readonly history?: RequestHistoryContext;
  readonly generateHistorySummary?: GenerateHistorySummary;
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
  const planningWarnings: RequestWarning[] = [];
  let policies = [...(input.representations ?? [])];
  if (input.history?.policy === "managed" && input.history.projection) {
    if (input.countTokens) {
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
    const managed = await resolveManagedHistoryPolicy({
      projection: input.history.projection,
      messages: request.messages,
      provider: input.provider,
      model: input.model,
      responseModel: input.responseModel,
      fullInputTokens: inputTokens,
      optimizeAt: budget.optimizeAt,
      max: budget.max,
      generate:
        input.generateHistorySummary ??
        (() =>
          Promise.reject(
            new TypeError(
              "The active adapter cannot prepare managed history summaries.",
            ),
          )),
    });
    if (managed.policy) policies.unshift(managed.policy);
    planningWarnings.push(...managed.warnings);
  }
  if (policies.length > 0) {
    policies = [
      ...(await prepareRepresentationPolicies({
        policies,
        provider: input.provider,
        model: input.model,
        responseModel: input.responseModel,
        fullInputTokens: inputTokens,
        max: budget.max,
        optimizeAt: budget.optimizeAt,
        generate: input.generateHistorySummary,
        request,
      })),
    ];
  }
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
      prepareRequest: async (candidate, selections) => {
        await prepareSelectedRepresentations(policies, selections);
        return input.prepareRequest
          ? input.prepareRequest(candidate, selections)
          : candidate;
      },
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
  const warnings = [
    ...requestWarnings(input, inputTokens, budget.optimizeAt),
    ...planningWarnings,
  ];
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

async function prepareSelectedRepresentations(
  policies: readonly ResolvedRepresentationPolicy[],
  selections: ReadonlyMap<string, number>,
): Promise<void> {
  for (const policy of policies) {
    const selected = selections.get(policy.contributor) ?? 0;
    const rung = policy.rungs[selected];
    if (!rung?.publish) continue;
    await rung.publish();
    await rung.validate?.();
  }
}
