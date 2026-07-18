import { prompt } from "@use-crux/core";
import type { LanguageModel } from "ai";
import { describe, expect, it } from "vitest";
import { createCruxAi } from "../../src";
import { scriptedGateway } from "../scripted-gateway";

describe("Crux run IDs for AI SDK loops", () => {
  it("keeps one canonical run ID on tool-enabled multistep output", async () => {
    const scripted = scriptedGateway({
      generateText: [
        {
          text: "done",
          steps: 2,
          toolCalls: [
            { toolCallId: "call-1", toolName: "search", input: { q: "crux" } },
          ],
        },
      ],
    });
    const ai = createCruxAi({ gateway: scripted.gateway });

    const result = await ai.generate(
      prompt({ id: "run-id-multistep", prompt: "Search, then answer." }),
      {
        model: model(),
        tools: {
          search: { description: "search", execute: async () => "found" },
        } as never,
      },
    );

    expect(result.runId).toMatch(/^run_[0-9a-f]{24}$/);
    expect(result.raw).toMatchObject({
      toolCalls: [{ toolCallId: "call-1", toolName: "search" }],
    });
    expect(result.raw?.steps).toHaveLength(2);
  });
});

function model(): LanguageModel {
  return {
    provider: "custom",
    modelId: "custom-model",
    specificationVersion: "v3",
  } as unknown as LanguageModel;
}
