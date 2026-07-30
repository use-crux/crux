import { apiUrl } from "@/shared/services/http";
import { parseStrictWireJson } from "@/shared/services/strict-wire-json";

import type { PromptLatestRunResponse } from "./types";
import { decodePromptLatestRunResult } from "./wire";

const REQUEST_HEADERS = {
  "X-Crux-Devtools-Request": "prompt-latest-run-v1",
} as const;
const MAX_RESPONSE_BYTES = 16_384;

/**
 * Resolve one canonical Prompt owner's latest captured operation at call time.
 *
 * The caller owns cancellation and must discard results after its navigation
 * generation retires. This function retains no operation, owner, or
 * availability state and never dispatches exact preview.
 */
export async function fetchPromptLatestRun(
  definitionId: string,
  signal?: AbortSignal,
): Promise<PromptLatestRunResponse> {
  const response = await fetch(
    apiUrl(
      `/api/devtools/prompt-latest-run/${encodeURIComponent(definitionId)}`,
    ),
    { headers: REQUEST_HEADERS, signal },
  );
  return decodePromptLatestRunResult(
    parseStrictWireJson(await response.text(), MAX_RESPONSE_BYTES),
    definitionId,
  );
}
