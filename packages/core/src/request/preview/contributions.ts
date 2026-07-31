/**
 * Redacted contribution boundaries retained for the runtime preview bridge.
 *
 * @module
 */

import type { SystemBlock } from "../../resolver/types";
import type { ResolvedRepresentationPolicy } from "../representation/ladder-types";
import type { RequestPreview } from "./types";

/** One model-facing contributor and its authorized pressure boundary. @internal */
export interface RequestPreviewContribution {
  readonly id: string;
  readonly boundary: "required" | "sticky" | "elastic";
  readonly representations: readonly string[];
}

const evidence = new WeakMap<
  RequestPreview,
  readonly RequestPreviewContribution[]
>();

/** Build a content-free contribution map from resolved request policy. @internal */
export function requestPreviewContributions(
  blocks: readonly SystemBlock[] | undefined,
  policies: readonly ResolvedRepresentationPolicy[],
): readonly RequestPreviewContribution[] {
  const contributions = new Map<string, RequestPreviewContribution>();
  for (const block of blocks ?? []) {
    const policy = policies.find(
      (candidate) =>
        candidate.sources.includes(block.source) ||
        candidate.contributor === block.source ||
        `context:${candidate.contributor}` === block.source,
    );
    const contribution = policy
      ? fromPolicy(policy)
      : {
          id: block.source,
          boundary: "required" as const,
          representations: ["full"],
        };
    contributions.set(contribution.id, contribution);
  }
  for (const policy of policies) {
    const contribution = fromPolicy(policy);
    contributions.set(contribution.id, contribution);
  }
  return Object.freeze(
    [...contributions.values()].map((value) =>
      Object.freeze({
        ...value,
        representations: Object.freeze([...value.representations]),
      }),
    ),
  );
}

/** Associate private bridge evidence with an otherwise unchanged preview. @internal */
export function retainRequestPreviewContributions(
  preview: RequestPreview,
  contributions: readonly RequestPreviewContribution[],
): void {
  evidence.set(preview, contributions);
}

/** Read private contribution evidence for runtime projection. @internal */
export function inspectRequestPreviewContributions(
  preview: RequestPreview,
): readonly RequestPreviewContribution[] {
  return evidence.get(preview) ?? [];
}

function fromPolicy(
  policy: ResolvedRepresentationPolicy,
): RequestPreviewContribution {
  const representations = policy.rungs.map((rung) => rung.kind);
  return {
    id: policy.contributor,
    boundary: representations.includes("omitted")
      ? "elastic"
      : representations.length > 1
        ? "sticky"
        : "required",
    representations,
  };
}
