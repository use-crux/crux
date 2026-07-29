import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { PROMPT_PREVIEW_MAX_REQUEST_BYTES } from "../../src/runtime-bridge/prompt-preview/limits";
import { canonicalPromptPreviewRequestJson } from "../../src/runtime-bridge/prompt-preview/request-json";
import {
  PromptPreviewRequestValidationError,
  validatePromptPreviewRequest,
} from "../../src/runtime-bridge/prompt-preview/validate";

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/prompt-preview-request-json-v1.json", import.meta.url),
    "utf8",
  ),
) as {
  readonly version: string;
  readonly value: {
    readonly payload: {
      readonly input: { readonly numbers: readonly number[] };
    };
  };
  readonly canonical: string;
  readonly byteCount: number;
};

describe("prompt-preview-request-json-v1", () => {
  it("matches the shared canonical UTF-8 golden", () => {
    const encoded = canonicalPromptPreviewRequestJson(fixture.value);

    expect(fixture.version).toBe("prompt-preview-request-json-v1");
    expect(encoded.json).toBe(fixture.canonical);
    expect(encoded.bytes).toBe(fixture.byteCount);
    expect(Object.is(fixture.value.payload.input.numbers[0], -0)).toBe(true);
  });

  it("accepts exact request bytes and rejects one byte of overflow", () => {
    const request = {
      type: "command.request",
      commandId: "cmd",
      command: "prompt.previewExact",
      targetId: "p",
      catalogueRevision: 1,
      payload: { input: { value: "" } },
      deadlineMs: 1_000,
    };
    const emptyBytes = canonicalPromptPreviewRequestJson(request).bytes;
    const escapedBytes = PROMPT_PREVIEW_MAX_REQUEST_BYTES - emptyBytes;
    const valueLength = Math.floor(escapedBytes / 6);
    request.payload.input.value = "\0".repeat(valueLength);
    const remaining =
      PROMPT_PREVIEW_MAX_REQUEST_BYTES -
      canonicalPromptPreviewRequestJson(request).bytes;
    request.targetId += "p".repeat(remaining);

    expect(canonicalPromptPreviewRequestJson(request).bytes).toBe(
      PROMPT_PREVIEW_MAX_REQUEST_BYTES,
    );
    expect(() => validatePromptPreviewRequest(request)).not.toThrow();

    request.targetId += "p";
    expect(() => validatePromptPreviewRequest(request)).toThrow(
      PromptPreviewRequestValidationError,
    );
  });
});
