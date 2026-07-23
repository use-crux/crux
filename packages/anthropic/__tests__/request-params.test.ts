import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { SystemBlock } from "@use-crux/core";
import { compileStructuredOutput } from "@use-crux/core/adapter";
import {
  anthropicRequest,
  anthropicStructuredCapabilities,
  anthropicSystemParam,
  mapAnthropicSettings,
} from "../src/request-params";

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

  const baseArgs = {
    model: "claude-3-5-sonnet",
    system: undefined,
    systemBlocks: undefined,
    messages: [],
    providerMessages: [],
    settings: {},
    schema: undefined,
    tools: undefined,
    extra: {},
  };

  it("places the core-compiled schema in output_config and drops rejected keywords", () => {
    const schema = z.object({ tags: z.array(z.string()).max(3) });
    const outputSchema = compileStructuredOutput(
      schema,
      anthropicStructuredCapabilities,
    ).outputSchema;

    const request = anthropicRequest({ ...baseArgs, schema, outputSchema });
    const format = (
      request.output_config as { format: { schema: Record<string, unknown> } }
    ).format;
    expect(format.schema).toMatchObject({ type: "object" });
    // Anthropic rejects `maxItems`; core lowering dropped it.
    expect(JSON.stringify(format.schema)).not.toContain("maxItems");
  });

  it("omits output_config for a non-structured request", () => {
    const request = anthropicRequest({ ...baseArgs, outputSchema: undefined });
    expect(request).not.toHaveProperty("output_config");
  });
});
