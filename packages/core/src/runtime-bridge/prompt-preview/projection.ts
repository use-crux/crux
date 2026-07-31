/**
 * Closed projection from request preview to the bounded runtime wire.
 *
 * @module
 */

import type { RequestPreview } from "../../request/preview/types";
import {
  PromptPreviewReadyResultSchema,
  type PromptPreviewResult,
} from "./result-protocol";
import {
  PROMPT_PREVIEW_MAX_RESULT_BYTES,
  PROMPT_PREVIEW_MAX_STRING_AGGREGATE_BYTES,
  compactJson,
  utf8Bytes,
} from "./limits";

export class PromptPreviewResultLimitError extends Error {
  override readonly name = "PromptPreviewResultLimitError";
}

/** Project the allowlisted redacted fields of one request preview. */
export function projectRequestPreview(
  targetId: string,
  catalogueRevision: number,
  preview: RequestPreview,
): PromptPreviewResult {
  const result = PromptPreviewReadyResultSchema.parse({
    status: "ready",
    targetId,
    catalogueRevision,
    preview,
  });
  if (
    stringBytes(result) > PROMPT_PREVIEW_MAX_STRING_AGGREGATE_BYTES ||
    compactJson(result).bytes > PROMPT_PREVIEW_MAX_RESULT_BYTES
  ) {
    throw new PromptPreviewResultLimitError(
      "Request preview result exceeds a limit.",
    );
  }
  return result;
}

function stringBytes(value: unknown): number {
  if (typeof value === "string") return utf8Bytes(value);
  if (Array.isArray(value)) {
    return value.reduce((total, child) => total + stringBytes(child), 0);
  }
  if (typeof value !== "object" || value === null) return 0;
  return Object.values(value).reduce(
    (total, child) => total + stringBytes(child),
    0,
  );
}
