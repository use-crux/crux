import type OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { prompt } from "@use-crux/core";
import { router } from "@use-crux/core/routing";
import { createOpenAI } from "../native";

const routed = router({
  classify: () => "fast" as const,
  routes: {
    fast: "gpt-4o-mini",
    default: "gpt-4o-mini",
  },
});

const supportPrompt = prompt({
  id: "openai-routing-rejection",
  system: "Answer briefly.",
});

declare const client: OpenAI;

describe("OpenAI native adapter routing support", () => {
  it("keeps wrappers rejected at the model option", () => {
    if (false) {
      const openai = createOpenAI(client);
      // @ts-expect-error OpenAI's native single-turn adapter accepts string model ids, not routing wrappers.
      void openai.generate(supportPrompt, { model: routed });
    }

    expect(true).toBe(true);
  });
});
