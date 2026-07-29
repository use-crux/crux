import { describe, expect, it } from "vitest";
import {
  parsePromptTextPreviewExactLinkResult,
  validatedPromptTextExactPreviewUrl,
} from "./exact-link.js";

describe("PromptText exact-preview owner link", () => {
  it("strictly decodes the closed result union", () => {
    expect(
      parsePromptTextPreviewExactLinkResult({
        kind: "ready",
        url: "http://localhost:4400/library/index/prompt/prompt%3Awriter/preview",
      }),
    ).toEqual({
      kind: "ready",
      url: "http://localhost:4400/library/index/prompt/prompt%3Awriter/preview",
    });
    expect(
      parsePromptTextPreviewExactLinkResult({
        kind: "ready",
        url: "http://localhost:4400/",
        targetId: "private",
      }),
    ).toBeUndefined();
    expect(
      parsePromptTextPreviewExactLinkResult({
        kind: "static-only",
        reason: "named-fragment",
        message: "Use static preview.",
      }),
    ).toMatchObject({ kind: "static-only", reason: "named-fragment" });
  });

  it("accepts only HTTP loopback at the configured Local port", () => {
    expect(
      validatedPromptTextExactPreviewUrl(
        "http://127.0.0.1:4400/library/index/prompt/x/preview",
        4400,
      ),
    ).toBe("http://127.0.0.1:4400/library/index/prompt/x/preview");
    expect(
      validatedPromptTextExactPreviewUrl(
        "http://[::1]:4400/library/index/prompt/x/preview",
        4400,
      ),
    ).toBe("http://[::1]:4400/library/index/prompt/x/preview");
    expect(
      validatedPromptTextExactPreviewUrl(
        "http://localhost/library/index/prompt/x/preview",
        80,
      ),
    ).toBe("http://localhost/library/index/prompt/x/preview");
    expect(
      validatedPromptTextExactPreviewUrl(
        "http://localhost:4401/library/index/prompt/x/preview",
        4400,
      ),
    ).toBeUndefined();
    expect(
      validatedPromptTextExactPreviewUrl(
        "https://localhost:4400/library/index/prompt/x/preview",
        4400,
      ),
    ).toBeUndefined();
    expect(
      validatedPromptTextExactPreviewUrl(
        "http://example.com:4400/library/index/prompt/x/preview",
        4400,
      ),
    ).toBeUndefined();
  });
});
