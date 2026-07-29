import { canonicalCompactPromptPreviewJson } from "./input/raw";
import type { PromptPreviewChoice } from "./types";

const MAX_CANONICAL_REQUEST_BYTES = 262_144;
const MAX_COMMAND_ID = "x".repeat(128);
const utf8 = new TextEncoder();

/**
 * Apply browser-advisory checks that depend on the selected runtime target.
 *
 * Local remains authoritative and measures the generated command ID. Using
 * the maximum permitted ID here guarantees that an enabled request fits for
 * every valid generated ID without exposing bridge identity to the browser.
 */
export function promptPreviewInputFits(
  definitionId: string,
  choice: PromptPreviewChoice,
  input: Readonly<Record<string, unknown>>,
): boolean {
  if (choice.target.input.mode === "none" && Object.keys(input).length !== 0) {
    return false;
  }
  const inputJson = canonicalCompactPromptPreviewJson(input);
  const request =
    `{"catalogueRevision":${choice.catalogueRevision},` +
    `"command":"prompt.previewExact",` +
    `"commandId":${JSON.stringify(MAX_COMMAND_ID)},` +
    `"deadlineMs":15000,` +
    `"payload":{"input":${inputJson}},` +
    `"targetId":${JSON.stringify(definitionId)},` +
    `"type":"command.request"}`;
  return utf8.encode(request).byteLength <= MAX_CANONICAL_REQUEST_BYTES;
}
