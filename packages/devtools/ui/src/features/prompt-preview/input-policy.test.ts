import { describe, expect, it } from "vitest";

import { promptPreviewInputFits } from "./input-policy";

const choice = {
  peerId: "peer",
  runtimeName: "App",
  environment: "node" as const,
  catalogueRevision: 1,
  target: { name: "Writer", input: { mode: "raw" as const } },
};

describe("Prompt preview input policy", () => {
  it("reserves the maximum command ID at the canonical request boundary", () => {
    const fits = (length: number): boolean =>
      promptPreviewInputFits("prompt:writer", choice, {
        text: "\u0000".repeat(length),
      });
    let lower = 0;
    let upper = 65_536;
    while (lower + 1 < upper) {
      const middle = Math.floor((lower + upper) / 2);
      if (fits(middle)) lower = middle;
      else upper = middle;
    }

    expect(fits(lower)).toBe(true);
    expect(fits(lower + 1)).toBe(false);
  });

  it("requires an empty object for an input-free target", () => {
    const noInput = {
      ...choice,
      target: { name: "Writer", input: { mode: "none" as const } },
    };
    expect(promptPreviewInputFits("prompt:writer", noInput, {})).toBe(true);
    expect(promptPreviewInputFits("prompt:writer", noInput, { value: 1 })).toBe(
      false,
    );
  });
});
