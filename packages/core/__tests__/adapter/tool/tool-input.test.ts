/**
 * Tool input compilation, decoding, and validation.
 *
 * Tool call arguments are decoded against the tool's compilation plan and then
 * validated once by the authored Zod `parameters` before `execute` runs on
 * `safeParse.data`. Invalid arguments settle as a model-visible tool error
 * without executing the tool or failing the generation.
 *
 * @module
 */

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createToolLifecycle } from "../../../src/adapter/tool/session";
import type { AdapterResponse } from "../../../src/adapter/types";
import type { ResolvedPrompt } from "../../../src/resolver/types";
import { strictCapabilities } from "../structured-output/capability-fixtures";

function resolvedWith(partial: Partial<ResolvedPrompt>): ResolvedPrompt {
  return { settings: {}, ...partial } as ResolvedPrompt;
}

function toolCallResponse(
  name: string,
  args: unknown,
): AdapterResponse {
  return {
    text: "",
    toolCalls: [{ id: "tc1", name, args }],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      inputTokenDetails: {},
      outputTokenDetails: {},
    },
    finishReason: "tool_calls",
    responseId: undefined,
    actualModelId: undefined,
  } as AdapterResponse;
}

describe("tool input validation", () => {
  it("executes on safeParse.data, applying authored defaults", async () => {
    const execute = vi.fn(async () => "ok");
    const lifecycle = createToolLifecycle({
      regime: "core",
      resolved: resolvedWith({
        tools: {
          search: {
            description: "search",
            parameters: z.object({ q: z.string(), limit: z.number().default(10) }),
            execute,
          },
        },
      }),
      promptId: "p1",
    });

    const round = await lifecycle.executeRound(
      toolCallResponse("search", { q: "x" }),
      [{ role: "user", content: "go" }],
    );

    expect(round.kind).toBe("completed");
    // Default is applied before the tool sees the arguments.
    expect(execute).toHaveBeenCalledWith(
      { q: "x", limit: 10 },
      expect.objectContaining({ toolCallId: "tc1" }),
    );
  });

  it("settles invalid arguments as a model-visible error without executing", async () => {
    const execute = vi.fn(async () => "ok");
    const lifecycle = createToolLifecycle({
      regime: "core",
      resolved: resolvedWith({
        tools: {
          search: {
            description: "search",
            parameters: z.object({ q: z.string() }),
            execute,
          },
        },
      }),
      promptId: "p1",
    });

    const round = await lifecycle.executeRound(
      toolCallResponse("search", { q: 123 }),
      [{ role: "user", content: "go" }],
    );

    expect(round.kind).toBe("completed");
    expect(execute).not.toHaveBeenCalled();
    const result = round.kind === "completed" ? round.results[0] : undefined;
    expect(result?.isError).toBe(true);
    // Sanitized message: names the schema mismatch, never echoes the value.
    expect(result?.modelOutputError).toBeDefined();
    expect(JSON.stringify(result)).not.toContain("123");
  });

  it("decodes a strict provider null sentinel back to an absent optional", async () => {
    const execute = vi.fn(async () => "ok");
    const lifecycle = createToolLifecycle({
      regime: "core",
      resolved: resolvedWith({
        tools: {
          search: {
            description: "search",
            parameters: z.object({ q: z.string(), note: z.string().optional() }),
            execute,
          },
        },
      }),
      promptId: "p1",
      structuredOutputCapabilities: strictCapabilities,
    });

    // Under strict lowering the optional `note` is required + nullable; the model
    // returns the null sentinel, which decodes back to an absent property.
    const round = await lifecycle.executeRound(
      toolCallResponse("search", { q: "x", note: null }),
      [{ role: "user", content: "go" }],
    );

    expect(round.kind).toBe("completed");
    expect(execute).toHaveBeenCalledWith(
      { q: "x" },
      expect.objectContaining({ toolCallId: "tc1" }),
    );
  });
});
