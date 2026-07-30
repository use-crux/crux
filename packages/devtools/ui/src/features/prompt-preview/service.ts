import { apiUrl } from "@/shared/services/http";

import type {
  PromptPreviewBrowserResponse,
  PromptPreviewChoice,
  PromptPreviewDiscovery,
} from "./types";
import {
  decodePromptPreviewBrowserResponse,
  decodePromptPreviewDiscovery,
} from "./wire";
import { parseStrictWireJson } from "@/shared/services/strict-wire-json";

const REQUEST_HEADER = {
  "X-Crux-Devtools-Request": "prompt-preview-v1",
} as const;
const MAX_DISCOVERY_BYTES = 2_097_152;
const MAX_RESPONSE_BYTES = 2_101_248;

/** Fetch the current browser-safe Prompt preview projection. */
export async function discoverPromptPreview(
  definitionId: string,
  signal?: AbortSignal,
): Promise<PromptPreviewDiscovery> {
  const response = await fetch(
    apiUrl(`/api/devtools/prompt-preview/${encodeURIComponent(definitionId)}`),
    { headers: REQUEST_HEADER, signal },
  );
  if (!response.ok) {
    throw new Error(
      `Prompt preview discovery failed with HTTP ${response.status}.`,
    );
  }
  return decodePromptPreviewDiscovery(
    parseStrictWireJson(await response.text(), MAX_DISCOVERY_BYTES),
  );
}

/** Execute one explicitly confirmed exact preview through Local's safe facade. */
export async function dispatchPromptPreview(
  definitionId: string,
  choice: PromptPreviewChoice,
  input: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<PromptPreviewBrowserResponse> {
  const response = await fetch(apiUrl("/api/devtools/prompt-preview"), {
    method: "POST",
    headers: {
      ...REQUEST_HEADER,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      version: 1,
      definitionId,
      peerId: choice.peerId,
      environment: choice.environment,
      catalogueRevision: choice.catalogueRevision,
      payload: { input },
    }),
    signal,
  });
  return decodePromptPreviewBrowserResponse(
    parseStrictWireJson(await response.text(), MAX_RESPONSE_BYTES),
    definitionId,
  );
}
