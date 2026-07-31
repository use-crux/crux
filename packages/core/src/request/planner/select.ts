/**
 * Deterministic two-tier request-candidate selection.
 *
 * @module
 */

import type { RequestCandidate } from "./candidates";
import type { CallArgs } from "../../adapter/types";
import type { ProviderMediaHooks } from "../../adapter/native-chat/media-hooks";
import type { InputBudget } from "../budget/input-budget";
import { RequestCompositionError } from "../errors";
import { estimateRequestTokens } from "../measure/estimate";
import {
  assertAuthoritativeTokenCount,
  type RequestTokenCounter,
} from "../measure/counter-port";
import type { RequestAdaptation } from "../receipt/adaptations";
import type { ResolvedRepresentationPolicy } from "../representation/ladder-types";
import {
  buildRequestBranchLowerBound,
  buildRequestCandidate,
  orderRepresentationPolicies,
  representationRungOptions,
} from "./candidates";
import {
  createRequestRepresentationEpoch,
  recordRepresentationSelection,
  representationFloors,
  type RequestRepresentationEpoch,
} from "./epoch";
import { compareRequestFidelity } from "./fidelity";

/** A measured complete-request candidate. @internal */
export interface MeasuredRequestCandidate<
  TExtra extends Record<string, unknown>,
> extends RequestCandidate<TExtra> {
  readonly inputTokens: number;
}

/** Select highest fidelity in the optimization tier, then the strict tier. @internal */
export function selectRequestCandidate<
  TExtra extends Record<string, unknown>,
>(
  candidates: readonly MeasuredRequestCandidate<TExtra>[],
  optimizeAt: number,
  max: number,
): MeasuredRequestCandidate<TExtra> | undefined {
  const ordered = [...candidates].sort(compareRequestFidelity);
  return (
    ordered.find((candidate) => candidate.inputTokens <= optimizeAt) ??
    ordered.find((candidate) => candidate.inputTokens <= max)
  );
}

/** Select and materialize one complete represented request. @internal */
export async function selectRepresentedRequest<
  TExtra extends Record<string, unknown>,
>(input: {
  readonly provider: string;
  readonly model: string;
  readonly requestId: string;
  readonly request: CallArgs<TExtra>;
  readonly policies: readonly ResolvedRepresentationPolicy[];
  readonly inputBudget?: InputBudget;
  readonly epoch?: RequestRepresentationEpoch;
  readonly media?: ProviderMediaHooks;
  readonly countTokens?: RequestTokenCounter<TExtra>;
  readonly prepareRequest?: (
    request: CallArgs<TExtra>,
    selections: ReadonlyMap<string, number>,
  ) => Promise<CallArgs<TExtra>>;
  readonly optimizeAt: number;
  readonly max: number;
}): Promise<{
  readonly request: CallArgs<TExtra>;
  readonly inputTokens: number;
  readonly estimate: ReturnType<typeof estimateRequestTokens<TExtra>>;
  readonly adaptations: readonly RequestAdaptation[];
  readonly counted: boolean;
  readonly selections: ReadonlyMap<string, number>;
} | undefined> {
  const epoch = input.epoch ?? createRequestRepresentationEpoch();
  const ordered = orderRepresentationPolicies(input.policies);
  const options = representationRungOptions(
    ordered,
    representationFloors(
      epoch,
      input.provider,
      input.model,
      input.inputBudget,
    ),
  );
  if (options.some((rungs) => rungs.length === 0)) {
    throw unavailableRepresentationError(input);
  }
  const measured = new Map<string, Promise<MeasuredRequestCandidate<TExtra>>>();
  const lowerBounds = new Map<string, Promise<number>>();
  const find = (limit: number) =>
    findCandidate({
      request: input.request,
      policies: ordered,
      options,
      limit,
      measure: (fidelity) => {
        const key = fidelity.join(":");
        let pending = measured.get(key);
        if (!pending) {
          pending = measureCandidate(
            buildRequestCandidate(input.request, ordered, fidelity),
            input,
            true,
          );
          measured.set(key, pending);
        }
        return pending;
      },
      lowerBound: (prefix) => {
        const key = prefix.join(":");
        let pending = lowerBounds.get(key);
        if (!pending) {
          const request = buildRequestBranchLowerBound(
            input.request,
            ordered,
            prefix,
          );
          pending = input.countTokens
            ? measureRequest(
                request,
                input,
                prefix.some((rung) => rung > 0),
                new Map(
                  ordered.map((policy, index) => [
                    policy.contributor,
                    prefix[index] ?? 0,
                  ]),
                ),
              )
            : Promise.resolve(
                estimateRequestTokens(request, {
                  provider: input.provider,
                  ...(input.media ? { media: input.media } : {}),
                }).inputTokens,
              );
          lowerBounds.set(key, pending);
        }
        return pending;
      },
    });
  const selected = (await find(input.optimizeAt)) ?? (await find(input.max));
  if (!selected) {
    if (hasUnavailableRung(input.policies)) {
      throw unavailableRepresentationError(input);
    }
    return undefined;
  }
  const estimate = estimateRequestTokens(selected.request, {
    provider: input.provider,
    ...(input.media ? { media: input.media } : {}),
  });
  const fullTokens = estimateRequestTokens(input.request, {
    provider: input.provider,
    ...(input.media ? { media: input.media } : {}),
  }).inputTokens;
  recordRepresentationSelection(epoch, selected.selections);
  return Object.freeze({
    request: selected.request,
    inputTokens: selected.inputTokens,
    estimate,
    adaptations: Object.freeze(
      selected.adaptations.map((adaptation) =>
        Object.freeze({
          ...adaptation,
          fullTokens,
          selectedTokens: selected.inputTokens,
        }),
      ),
    ),
    counted: !!input.countTokens,
    selections: selected.selections,
  });
}

async function findCandidate<TExtra extends Record<string, unknown>>(input: {
  readonly request: CallArgs<TExtra>;
  readonly policies: readonly ResolvedRepresentationPolicy[];
  readonly options: readonly (readonly number[])[];
  readonly limit: number;
  readonly measure: (
    fidelity: readonly number[],
  ) => Promise<MeasuredRequestCandidate<TExtra>>;
  readonly lowerBound: (prefix: readonly number[]) => Promise<number>;
}): Promise<MeasuredRequestCandidate<TExtra> | undefined> {
  const visit = async (
    index: number,
    prefix: readonly number[],
  ): Promise<MeasuredRequestCandidate<TExtra> | undefined> => {
    if ((await input.lowerBound(prefix)) > input.limit) return undefined;
    if (index === input.options.length) {
      const candidate = await input.measure(prefix);
      return candidate.inputTokens <= input.limit ? candidate : undefined;
    }
    for (const rung of input.options[index] ?? []) {
      const selected = await visit(index + 1, [...prefix, rung]);
      if (selected) return selected;
    }
    return undefined;
  };
  return visit(0, []);
}

async function measureRequest<TExtra extends Record<string, unknown>>(
  request: CallArgs<TExtra>,
  input: {
    readonly provider: string;
    readonly media?: ProviderMediaHooks;
    readonly countTokens?: RequestTokenCounter<TExtra>;
    readonly prepareRequest?: (
      request: CallArgs<TExtra>,
      selections: ReadonlyMap<string, number>,
    ) => Promise<CallArgs<TExtra>>;
  },
  prepare: boolean,
  selections?: ReadonlyMap<string, number>,
): Promise<number> {
  const prepared =
    prepare && input.prepareRequest && selections
      ? await input.prepareRequest(request, selections)
      : request;
  if (input.countTokens) {
    return assertAuthoritativeTokenCount(await input.countTokens(prepared));
  }
  return estimateRequestTokens(prepared, {
    provider: input.provider,
    ...(input.media ? { media: input.media } : {}),
  }).inputTokens;
}

async function measureCandidate<TExtra extends Record<string, unknown>>(
  candidate: RequestCandidate<TExtra>,
  input: {
    readonly provider: string;
    readonly media?: ProviderMediaHooks;
    readonly countTokens?: RequestTokenCounter<TExtra>;
    readonly prepareRequest?: (
      request: CallArgs<TExtra>,
      selections: ReadonlyMap<string, number>,
    ) => Promise<CallArgs<TExtra>>;
  },
  prepare: boolean,
): Promise<MeasuredRequestCandidate<TExtra>> {
  const request =
    prepare && input.prepareRequest
      ? await input.prepareRequest(candidate.request, candidate.selections)
      : candidate.request;
  const inputTokens = await measureRequest(request, input, false);
  return Object.freeze({ ...candidate, request, inputTokens });
}

function hasUnavailableRung(
  policies: readonly ResolvedRepresentationPolicy[],
): boolean {
  return policies.some((policy) =>
    policy.rungs.some((rung) => !rung.available),
  );
}

function unavailableRepresentationError(input: {
  readonly requestId: string;
  readonly model: string;
  readonly policies: readonly ResolvedRepresentationPolicy[];
}): RequestCompositionError {
  const missing = input.policies
    .flatMap((policy) =>
      policy.rungs
        .filter((rung) => !rung.available)
        .map((rung) => rung.kind),
    )
    .at(0);
  const capability =
    missing === "summary"
      ? "generated summary artifacts"
      : "exact-recovery reference backing";
  return new RequestCompositionError(
    "REPRESENTATION_UNAVAILABLE",
    `Request "${input.requestId}" for model "${input.model}" requires ${capability}, but that representation is not prepared.`,
    [
      {
        id: `${input.requestId}:representation`,
        code: "REPRESENTATION_CAPABILITY_UNAVAILABLE",
        contributor: "representation",
        message:
          `Prepare ${capability}, authorize another available rung, reduce exact input, or increase inputBudget.max.`,
      },
    ],
    input.requestId,
  );
}
