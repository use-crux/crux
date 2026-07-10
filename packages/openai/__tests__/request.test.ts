import { describe, expect, it } from "vitest";
import { openAISettings } from "../src/request";

describe("OpenAI request settings", () => {
  it("maps portable reasoning effort to OpenAI reasoning_effort", () => {
    expect(openAISettings({ reasoning: "high" })).toMatchObject({
      reasoning_effort: "high",
    });
    expect(openAISettings({ reasoning: "high" })).not.toHaveProperty(
      "reasoning",
    );
  });
});
