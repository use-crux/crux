/**
 * Redacted inspection evidence projected from request selection.
 *
 * @module
 */

import type { ProviderMediaHooks } from "../../adapter/native-chat/media-hooks";
import type { CallArgs } from "../../adapter/types";
import { estimateRequestTokens } from "../measure/estimate";
import {
  buildRequestCandidate,
  orderRepresentationPolicies,
} from "../planner/candidates";
import type { RequestAdaptation } from "./adaptations";
import type { RequestInspectionEvidence } from "./inspection";
import type { ResolvedRepresentationPolicy } from "../representation/ladder-types";

/** Build content-free candidate, artifact, and linkage evidence. @internal */
export function requestInspectionEvidence<
  TExtra extends Record<string, unknown>,
>(input: {
  readonly request: CallArgs<TExtra>;
  readonly policies: readonly ResolvedRepresentationPolicy[];
  readonly selections: ReadonlyMap<string, number>;
  readonly adaptations: readonly RequestAdaptation[];
  readonly provider: string;
  readonly maxInputTokens: number;
  readonly media?: ProviderMediaHooks;
  readonly previousRequestId?: string;
}): RequestInspectionEvidence {
  const policies = orderRepresentationPolicies(input.policies);
  const selectedVector = policies.map(
    (policy) => input.selections.get(policy.contributor) ?? 0,
  );
  const contributions = policies.map((policy) =>
    Object.freeze({
      id: policy.contributor,
      sources: Object.freeze([...policy.sources]),
      priority: policy.priority,
      representations: Object.freeze(
        policy.rungs.map((rung) => rung.kind),
      ),
    }),
  );
  const candidates = policies.flatMap((policy, policyIndex) =>
    policy.rungs.map((rung, rungIndex) => {
      const selected = selectedVector[policyIndex] === rungIndex;
      const inputTokens = rung.available
        ? estimateRequestTokens(
            buildRequestCandidate(
              input.request,
              policies,
              selectedVector.map((value, index) =>
                index === policyIndex ? rungIndex : value,
              ),
            ).request,
            {
              provider: input.provider,
              ...(input.media ? { media: input.media } : {}),
            },
          ).inputTokens
        : undefined;
      return Object.freeze({
        contributor: policy.contributor,
        representation: rung.kind,
        available: rung.available,
        selected,
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(!selected
          ? {
              rejectionReason: !rung.available
                ? "unprepared" as const
                : inputTokens !== undefined &&
                    inputTokens > input.maxInputTokens
                  ? "over-limit" as const
                  : "lower-fidelity" as const,
            }
          : {}),
      });
    }),
  );
  const artifacts = input.adaptations.flatMap((adaptation) =>
    adaptation.representation === "summary" ||
    adaptation.representation === "offload"
      ? [Object.freeze({
          contributor: adaptation.contributor,
          kind: adaptation.representation,
          supportRequestIds: Object.freeze([
            ...(adaptation.supportRequestIds ??
              (adaptation.supportRequestId
                ? [adaptation.supportRequestId]
                : [])),
          ]),
        })]
      : [],
  );
  const supportTools = [
    ...new Set(policies.flatMap((policy) => policy.supportToolNames ?? [])),
  ];
  const linkedRequestIds = [
    ...(input.previousRequestId ? [input.previousRequestId] : []),
    ...artifacts.flatMap((artifact) => artifact.supportRequestIds),
  ];
  return Object.freeze({
    contributions: Object.freeze(contributions),
    candidates: Object.freeze(candidates),
    artifacts: Object.freeze(artifacts),
    supportTools: Object.freeze(supportTools),
    linkedRequestIds: Object.freeze([...new Set(linkedRequestIds)]),
  });
}
