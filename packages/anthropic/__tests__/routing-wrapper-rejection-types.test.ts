import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { prompt } from "@use-crux/core";
import { router } from "@use-crux/core/routing";
import { createAnthropic } from "../native";

const routed = router({
  classify: () => "fast" as const,
  routes: {
    fast: "claude-haiku-4-5",
    default: "claude-haiku-4-5",
  },
});

const supportPrompt = prompt({
  id: "anthropic-routing-rejection",
  system: "Answer briefly.",
});

declare const client: Anthropic;

describe("Anthropic native adapter routing support", () => {
  it("keeps wrappers rejected at the model option", () => {
    if (false) {
      const anthropic = createAnthropic(client);
      // @ts-expect-error Anthropic's native single-turn adapter accepts string model ids, not routing wrappers.
      void anthropic.generate(supportPrompt, { model: routed });
    }

    expect(true).toBe(true);
  });
});
