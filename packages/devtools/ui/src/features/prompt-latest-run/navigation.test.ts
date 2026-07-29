import { describe, expect, it } from "vitest";

import { pathFromState, stateFromPath } from "@/app/navigation/useNavigation";

describe("Prompt latest-Run navigation", () => {
  it.each([
    "prompt:billing/support",
    "prompt:100%",
    "prompt:what?#",
    "prompt:résumé/😀",
    "prompt:a+b",
  ])("round-trips one encoded definition ID: %s", (definitionId) => {
    const state = { view: "prompt-latest-run", definitionId } as const;
    expect(stateFromPath(pathFromState(state))).toEqual(state);
  });

  it("decodes exactly once and preserves plus", () => {
    expect(
      stateFromPath("/library/index/prompt/prompt%253Aone%252Ftwo/latest-run"),
    ).toEqual({
      view: "prompt-latest-run",
      definitionId: "prompt%3Aone%2Ftwo",
    });
    expect(
      stateFromPath("/library/index/prompt/prompt%3Aa+b/latest-run"),
    ).toEqual({
      view: "prompt-latest-run",
      definitionId: "prompt:a+b",
    });
  });
});
