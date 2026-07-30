import { describe, expect, it } from "vitest";

import { pathFromState, stateFromPath } from "@/app/navigation/useNavigation";

describe("Prompt preview navigation", () => {
  it.each([
    "prompt:billing/support",
    "prompt:100%",
    "prompt:what?#",
    "prompt:résumé/😀",
    "prompt:a+b",
  ])("round-trips one encoded definition ID: %s", (definitionId) => {
    const state = { view: "prompt-preview", definitionId } as const;
    expect(stateFromPath(pathFromState(state))).toEqual(state);
  });

  it("decodes exactly once and preserves plus", () => {
    expect(
      stateFromPath("/library/index/prompt/prompt%253Aone%252Ftwo/preview"),
    ).toEqual({
      view: "prompt-preview",
      definitionId: "prompt%3Aone%2Ftwo",
    });
    expect(stateFromPath("/library/index/prompt/prompt%3Aa+b/preview")).toEqual(
      { view: "prompt-preview", definitionId: "prompt:a+b" },
    );
  });

  it.each([
    "/library/index/prompt/%/preview",
    "/library/index/prompt/id/preview/extra",
    "/library/index/prompt/id/preview/",
    "/library//index/prompt/id/preview",
    "//library/index/prompt/id/preview",
    "/library/index/prompt/preview",
    "/library/index/prompt/id",
  ])("rejects malformed or noncanonical path %s", (path) => {
    expect(stateFromPath(path)).toEqual({ view: "overview" });
  });
});
