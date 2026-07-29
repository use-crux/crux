import { describe, expect, it } from "vitest";
import {
  parsePromptTextLatestRunLinkResult,
  validatedPromptTextLatestRunUrl,
} from "./latest-link.js";

describe("PromptText latest-Run owner link", () => {
  it("strictly decodes the independent ready/unavailable union", () => {
    expect(
      parsePromptTextLatestRunLinkResult({
        kind: "ready",
        url: "http://localhost:4400/library/index/prompt/prompt%3Awriter/latest-run",
      }),
    ).toEqual({
      kind: "ready",
      url: "http://localhost:4400/library/index/prompt/prompt%3Awriter/latest-run",
    });
    expect(
      parsePromptTextLatestRunLinkResult({
        kind: "ready",
        url: "http://localhost:4400/",
        operationId: "forbidden",
      }),
    ).toBeUndefined();
    expect(
      parsePromptTextLatestRunLinkResult({
        kind: "unavailable",
        reason: "named-fragment",
        message: "Open its canonical Prompt owner.",
      }),
    ).toMatchObject({ kind: "unavailable", reason: "named-fragment" });
  });

  it("accepts only a canonical resolver path on HTTP loopback at the configured port", () => {
    expect(
      validatedPromptTextLatestRunUrl(
        "http://127.0.0.1:4400/library/index/prompt/prompt%3Aa%2Fb/latest-run",
        4400,
      ),
    ).toBe(
      "http://127.0.0.1:4400/library/index/prompt/prompt%3Aa%2Fb/latest-run",
    );
    for (const unsafe of [
      "http://localhost:4401/library/index/prompt/prompt%3Aa/latest-run",
      "https://localhost:4400/library/index/prompt/prompt%3Aa/latest-run",
      "http://example.com:4400/library/index/prompt/prompt%3Aa/latest-run",
      "http://user@localhost:4400/library/index/prompt/prompt%3Aa/latest-run",
      "http://localhost:4400/library/index/prompt/prompt%3Aa/latest-run?x=1",
      "http://localhost:4400/library/index/prompt/prompt%3Aa/latest-run#x",
      "http://localhost:4400/library/index/prompt/prompt%3aa/latest-run",
      "http://localhost:4400/library/index/prompt/prompt%3Aa/preview",
    ]) {
      expect(validatedPromptTextLatestRunUrl(unsafe, 4400)).toBeUndefined();
    }
  });
});
