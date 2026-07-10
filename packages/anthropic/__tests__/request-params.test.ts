import { describe, expect, it } from "vitest";
import type { SystemBlock } from "@use-crux/core";
import { anthropicSystemParam, mapAnthropicSettings } from "../src/request-params";

describe("anthropic request params", () => {
  it("breakpoint placed at cacheBoundary", () => {
    const blocks: SystemBlock[] = [
      { source: "prompt", text: "identity", providerCache: true },
      { source: "context:a", text: "cached a", providerCache: true },
      {
        source: "context:b",
        text: "cached b",
        providerCache: true,
        cacheBoundary: true,
      },
      { source: "context:tail", text: "tail", providerCache: false },
    ];

    const system = anthropicSystemParam("joined", blocks);

    expect(system).toEqual([
      { type: "text", text: "identity" },
      { type: "text", text: "cached a" },
      { type: "text", text: "cached b", cache_control: { type: "ephemeral" } },
      { type: "text", text: "tail" },
    ]);
  });

  it("maps portable reasoning effort to Anthropic thinking budgets", () => {
    expect(mapAnthropicSettings({ reasoning: "medium" })).toMatchObject({
      thinking: { type: "enabled", budget_tokens: 8000 },
    });
    expect(mapAnthropicSettings({ reasoning: "medium" })).not.toHaveProperty(
      "reasoning",
    );
  });
});
