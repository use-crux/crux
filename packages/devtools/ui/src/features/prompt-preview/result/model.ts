import type { PromptPreviewSegment, PromptPreviewText } from "../types";

export interface PromptPreviewTextSlice extends PromptPreviewSegment {
  readonly text: string;
}

/**
 * Materializes already-validated UTF-16 provenance ranges for presentation.
 * The wire decoder remains the authority for contiguity and bounds.
 */
export function promptPreviewTextSlices(
  value: PromptPreviewText,
): readonly PromptPreviewTextSlice[] {
  return value.segments.map((segment) => ({
    ...segment,
    text: value.text.slice(segment.startUtf16, segment.endUtf16),
  }));
}

/** Formats one validation path without interpreting its source schema. */
export function promptPreviewIssuePath(
  path: readonly (string | number)[],
): string {
  return path.length === 0 ? "(input)" : path.join(".");
}
