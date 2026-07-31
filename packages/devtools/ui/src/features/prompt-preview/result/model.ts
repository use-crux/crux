import type { PromptPreviewContribution, PromptRequestPreview } from "../types";

/** Human-readable fit label for one closed preview status. */
export function promptPreviewStatusLabel(
  status: PromptRequestPreview["status"],
): string {
  switch (status) {
    case "fits":
      return "Fits";
    case "over-limit":
      return "Over limit";
    case "unknown":
      return "Needs preparation";
  }
}

/** Explain what one contribution boundary permits under request pressure. */
export function contributionBoundaryDescription(
  boundary: PromptPreviewContribution["boundary"],
): string {
  switch (boundary) {
    case "required":
      return "Exact and always retained";
    case "sticky":
      return "May shrink but cannot disappear";
    case "elastic":
      return "May shrink or be omitted";
  }
}

/** Formats one validation path without interpreting its source schema. */
export function promptPreviewIssuePath(
  path: readonly (string | number)[],
): string {
  return path.length === 0 ? "(input)" : path.join(".");
}
