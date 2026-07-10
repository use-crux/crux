import { describe, expect, it } from "vitest";
import {
  createInvalidMediaSourceError,
  createUnsupportedCapabilityError,
  isInvalidMediaSourceError,
  isUnsupportedCapabilityError,
} from "@use-crux/core";

describe("media boundary errors", () => {
  it("creates structural invalid-media errors without class identity", () => {
    const error = createInvalidMediaSourceError({
      path: "messages[0].content[1].source",
      reason: "Raw base64 strings are not media sources.",
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("InvalidMediaSourceError");
    expect(error.code).toBe("invalid_media_source");
    expect(error.path).toBe("messages[0].content[1].source");
    expect(isInvalidMediaSourceError(error)).toBe(true);
    expect(isInvalidMediaSourceError({ ...error })).toBe(true);
  });

  it("aggregates unsupported capability issues in order and mirrors the first issue", () => {
    const error = createUnsupportedCapabilityError({
      adapter: "openai",
      model: "gpt-test",
      issues: [
        {
          capability: "input.image",
          path: "messages[0].content[1].source",
          mediaType: "image/tiff",
          remediation: "Use PNG, JPEG, GIF, or WebP.",
        },
        {
          capability: "input.file",
          path: "messages[1].content[0].source",
          mediaType: "application/pdf",
          remediation: "Choose a file-capable model.",
        },
      ],
    });

    expect(error).toMatchObject({
      name: "UnsupportedCapabilityError",
      code: "unsupported_capability",
      adapter: "openai",
      model: "gpt-test",
      capability: "input.image",
      path: "messages[0].content[1].source",
      mediaType: "image/tiff",
    });
    expect(error.issues.map((issue) => issue.capability)).toEqual([
      "input.image",
      "input.file",
    ]);
    expect(error.message).toContain("No provider request was made.");
    expect(error.message).toContain("messages[1].content[0].source");
    expect(isUnsupportedCapabilityError(error)).toBe(true);
    expect(isUnsupportedCapabilityError({ ...error })).toBe(true);
  });

  it("keeps secret media locators out of unsupported error messages", () => {
    const error = createUnsupportedCapabilityError({
      adapter: "anthropic",
      model: "<custom>",
      issues: [
        {
          capability: "input.provider-file",
          path: "messages[0].content[0].source",
          remediation: "Hydrate the file into a supported asset first.",
        },
      ],
    });

    expect(error.message).not.toContain("file-secret");
    expect(error.message).not.toContain("asset://");
    expect(error.message).not.toContain("token=");
  });
});
