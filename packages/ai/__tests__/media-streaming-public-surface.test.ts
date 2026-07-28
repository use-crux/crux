import { describe, expect, expectTypeOf, it } from "vitest";
import { createCruxAi } from "../src";

describe("AI SDK bounded media streaming surface", () => {
  it("structurally omits unsupported image and speech streams", () => {
    const ai = createCruxAi();

    expect(ai).not.toHaveProperty("streamImage");
    expect(ai).not.toHaveProperty("streamSpeech");
    expectTypeOf(ai).not.toHaveProperty("streamImage");
    expectTypeOf(ai).not.toHaveProperty("streamSpeech");
  });
});
