/**
 * Operation-specific contributor facet applicability.
 *
 * @internal
 * @module
 */

import type { OperationKind } from "../prepare/amendment";
import type { ContextEntry } from "../../prompt/context-types";
import { RequestCompositionError } from "../errors";

/** Stable outcomes produced for one contributor facet. */
export type FacetApplicability =
  | "applicable"
  | "dormant-facet"
  | "inert-rejected"
  | "unsupported-required"
  | "omitted-optional";

/** Compiler-owned description of one contributor facet. @internal */
export interface OperationFacet {
  readonly id: string;
  readonly operations: readonly OperationKind[];
  readonly supported: boolean;
  readonly required: boolean;
  readonly omitted?: boolean;
}

/** Content-free classification of one contributor facet. @internal */
export interface FacetClassification {
  readonly id: string;
  readonly status: FacetApplicability;
}

/** Classify every facet and append an inert aggregate when none can engage. */
export function classifyContributorFacets(
  operation: OperationKind,
  facets: readonly OperationFacet[],
): readonly FacetClassification[] {
  const classified = facets.map((facet) =>
    Object.freeze({
      id: facet.id,
      status: classifyFacet(operation, facet),
    }),
  );
  const engaged = classified.some(
    ({ status }) =>
      status === "applicable" || status === "omitted-optional",
  );
  return Object.freeze([
    ...classified,
    ...(!engaged && classified.length > 0
      ? [
          Object.freeze({
            id: "contributor",
            status: "inert-rejected" as const,
          }),
        ]
      : []),
  ]);
}

/** Classify the currently supported language representation of each entry. */
export function classifyLanguageContributors(
  entries: readonly ContextEntry[],
): readonly FacetClassification[] {
  return Object.freeze(
    entries.flatMap((entry, index) => {
      if (!entry || typeof entry !== "object") return [];
      const identity =
        "id" in entry && typeof entry.id === "string"
          ? entry.id
          : `contributor-${index}`;
      return classifyContributorFacets("language", [
        {
          id: `${identity}:language`,
          operations: ["language"],
          supported: true,
          required: true,
        },
      ]);
    }),
  );
}

/** Reject inert contributors and unsupported required facets before I/O. */
export function assertApplicableContributorFacets(
  classifications: readonly FacetClassification[],
): void {
  const rejected = classifications.filter(
    ({ status }) =>
      status === "inert-rejected" ||
      status === "unsupported-required",
  );
  if (rejected.length === 0) return;
  throw new RequestCompositionError(
    "INVALID_COMPOSITION",
    "A required contributor facet is not applicable to this operation.",
    rejected.map((classification, index) =>
      Object.freeze({
        id: `facet-${index}`,
        code: classification.status,
        contributor: classification.id,
        message:
          classification.status === "inert-rejected"
            ? "Every declared facet is dormant for this operation."
            : "A required facet is unsupported for this operation.",
      }),
    ),
    `facet_${Date.now().toString(36)}`,
  );
}

function classifyFacet(
  operation: OperationKind,
  facet: OperationFacet,
): FacetApplicability {
  if (!facet.operations.includes(operation)) return "dormant-facet";
  if (!facet.supported && facet.required) return "unsupported-required";
  if (facet.omitted && !facet.required) return "omitted-optional";
  return facet.supported ? "applicable" : "dormant-facet";
}
