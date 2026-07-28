import {
  CRUX_OBSERVABILITY_REDACTION_SURFACES,
  type CruxObservabilityRedactionEvidence,
  type CruxObservabilityRedactionSurface,
} from "@use-crux/core/observability";
import type { ObservabilityRunDetailNode } from "@/types";

const surfaceLabels = {
  "artifact.preview": "Artifact preview",
  "artifact.uri": "Artifact URI",
  attributes: "Attributes",
  "error.message": "Error message",
} satisfies Record<CruxObservabilityRedactionSurface, string>;

export const REDACTION_EVIDENCE_TOOLTIP =
  "Configured patterns changed captured telemetry here.";

/** Formats only the closed, privacy-safe redaction surface vocabulary. */
export function formatRedactionSurfaces(
  evidence: CruxObservabilityRedactionEvidence | undefined,
): string[] {
  if (!evidence?.applied) return [];
  const present = new Set(evidence.surfaces);
  return CRUX_OBSERVABILITY_REDACTION_SURFACES.flatMap((surface) =>
    present.has(surface) ? [surfaceLabels[surface]] : [],
  );
}

/** Tests explicit runtime evidence without inspecting captured telemetry. */
export function hasRedactionEvidence(
  evidence: CruxObservabilityRedactionEvidence | undefined,
): boolean {
  return evidence?.applied === true && formatRedactionSurfaces(evidence).length > 0;
}

/** Returns whether this tree row owns explicit evidence, including folded details. */
export function hasLocalRedaction(node: ObservabilityRunDetailNode): boolean {
  return (
    hasRedactionEvidence(node.redaction) ||
    (node.details ?? []).some((detail) => hasRedactionEvidence(detail.redaction))
  );
}

export interface RedactionTreeState {
  local: boolean;
  descendant: boolean;
}

/** Computes count-free local/descendant markers from the projected tree. */
export function redactionTreeState(
  node: ObservabilityRunDetailNode,
): RedactionTreeState {
  const childStates = (node.children ?? []).map(redactionTreeState);
  return {
    local: hasLocalRedaction(node),
    descendant: childStates.some((state) => state.local || state.descendant),
  };
}
