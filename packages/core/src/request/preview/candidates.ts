/**
 * Candidate measurement and public adaptation projection for preview.
 *
 * @module
 */

import type { CallArgs } from "../../adapter/types";
import { estimateRequestTokens } from "../measure/estimate";
import {
  requestCandidates,
  type RequestCandidate,
} from "../planner/candidates";
import { selectRequestCandidate } from "../planner/select";
import type { RequestAdaptation } from "../receipt/adaptations";
import type { ResolvedRepresentationPolicy } from "../representation/ladder-types";
import type { PreviewAdaptation } from "./types";

/** One complete candidate measured without reserving it. @internal */
export interface MeasuredPreviewCandidate
  extends RequestCandidate<Record<string, unknown>> {
  readonly inputTokens: number;
}

/** Select the highest-fidelity candidate in the soft or strict tier. @internal */
export function selectPreviewCandidate(
  request: CallArgs,
  policies: readonly ResolvedRepresentationPolicy[],
  optimizeAt: number,
  max: number,
  provider: string,
): MeasuredPreviewCandidate | undefined {
  return selectRequestCandidate(
    measuredCandidates(request, policies, provider),
    optimizeAt,
    max,
  );
}

/** Find the smallest complete prospective candidate. @internal */
export function minimumPreviewCandidate(
  request: CallArgs,
  policies: readonly ResolvedRepresentationPolicy[],
  provider: string,
): MeasuredPreviewCandidate | undefined {
  return measuredCandidates(request, policies, provider)
    .sort((left, right) => left.inputTokens - right.inputTokens)[0];
}

/** Project safe public adaptation facts for one prospective selection. @internal */
export function previewAdaptations(
  candidate: MeasuredPreviewCandidate,
  original: readonly ResolvedRepresentationPolicy[],
  selectedTokens: number,
): readonly PreviewAdaptation[] {
  const byContributor = new Map(
    original.map((policy) => [policy.contributor, policy]),
  );
  return Object.freeze(
    candidate.adaptations.map((adaptation: RequestAdaptation) => {
      const policy = byContributor.get(adaptation.contributor);
      const rung = policy?.rungs[
        candidate.selections.get(adaptation.contributor) ?? 0
      ];
      return Object.freeze({
        contributor: adaptation.contributor,
        representation: adaptation.representation,
        state: rung?.available === false
          ? "unprepared" as const
          : "selected" as const,
        selectedTokens,
      });
    }),
  );
}

function measuredCandidates(
  request: CallArgs,
  policies: readonly ResolvedRepresentationPolicy[],
  provider: string,
): MeasuredPreviewCandidate[] {
  return requestCandidates(request, policies, new Map()).map(
    (candidate) => ({
      ...candidate,
      inputTokens: estimateRequestTokens(candidate.request, {
        provider,
      }).inputTokens,
    }),
  );
}
