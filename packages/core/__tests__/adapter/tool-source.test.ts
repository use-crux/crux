import { mcp, stdio } from "@use-crux/mcp";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { adapter } from "../../src/adapter/define-adapter";
import type { AdapterResponse, ToolResultEntry } from "../../src/adapter/types";
import { context } from "../../src/prompt/context";
import { prompt } from "../../src/prompt/prompt";
import type { Message } from "../../src/generation/messages";

const usage = {
  inputTokens: 1,
  outputTokens: 1,
  totalTokens: 2,
  inputTokenDetails: {},
  outputTokenDetails: {},
} as const;

function response(
  text: string,
  toolCalls?: AdapterResponse["toolCalls"],
): AdapterResponse {
  return {
    text,
    toolCalls,
    usage,
    finishReason: toolCalls ? "tool_calls" : "stop",
  };
}

describe("portable tool sources", () => {
  it("materializes a nested source before provider I/O and closes it after the tool loop", async () => {
    const events: string[] = [];
    const source = mcp({
      id: "fixture",
      transport: stdio({ command: "fixture-server" }),
    });
    const materializeToolSource = vi.fn(async (candidate) => {
      expect(candidate).toBe(source);
      events.push("materialize");
      return {
        tools: {
          lookup: {
            description: "Look up a fixture value.",
            parameters: z.object({ key: z.string() }),
            execute: async ({ key }: { key: string }) => {
              events.push(`tool:${key}`);
              return { value: 42 };
            },
          },
        },
        close: vi.fn(async () => {
          events.push("close");
        }),
      };
    });

    let providerCalls = 0;
    const createFixtureAdapter = adapter({
      providerId: "fixture-provider",
      materializeToolSource,
      mapSettings: () => ({}),
      async call() {
        providerCalls += 1;
        events.push(`provider:${providerCalls}`);
        if (providerCalls === 1) {
          return {
            raw: { step: 1 },
            extracted: response("", [
              { id: "call-1", name: "lookup", args: { key: "answer" } },
            ]),
          };
        }
        return {
          raw: { step: 2 },
          extracted: response("The fixture value is 42."),
        };
      },
      async stream() {
        throw new Error("stream is not used by this test");
      },
      appendToolRound(
        messages: Message[],
        assistant: AdapterResponse,
        results: ToolResultEntry[],
      ) {
        return [
          ...messages,
          {
            role: "assistant" as const,
            content: assistant.text,
            metadata: { toolCalls: assistant.toolCalls },
          },
          ...results.map((result) => ({
            role: "tool" as const,
            content: result.content,
            metadata: { toolCallId: result.toolCallId, toolName: result.name },
          })),
        ];
      },
    });
    const fixtureAdapter = createFixtureAdapter({});
    const nested = context({
      id: "nested",
      use: [source],
      system: "Use the fixture when needed.",
    });
    const assistant = prompt({
      id: "tool-source-tracer",
      use: [nested],
      prompt: "Find the answer.",
    });

    const result = await fixtureAdapter.generate(assistant, {
      model: "fixture-model",
    });

    expect(result.text).toBe("The fixture value is 42.");
    expect(materializeToolSource).toHaveBeenCalledOnce();
    expect(events).toEqual([
      "materialize",
      "provider:1",
      "tool:answer",
      "provider:2",
      "close",
    ]);
  });

  it("keeps resolution inert and rejects unsupported dialects before provider I/O", async () => {
    const source = mcp({
      id: "unsupported-server",
      transport: stdio({ command: "must-not-spawn" }),
    });
    const assistant = prompt({
      id: "unsupported-tool-source",
      use: [source],
      prompt: "Do not call the provider.",
    });
    const call = vi.fn(async () => ({
      raw: { unexpected: true },
      extracted: response("unexpected"),
    }));
    const createUnsupportedAdapter = adapter({
      providerId: "unsupported-provider",
      call,
      mapSettings: () => ({}),
      async stream() {
        throw new Error("stream is not used by this test");
      },
      appendToolRound(messages) {
        return messages;
      },
    });

    const resolved = await assistant.resolve({});

    expect(resolved.toolSources).toEqual([source]);
    await expect(
      createUnsupportedAdapter({}).generate(assistant, {
        model: "fixture-model",
      }),
    ).rejects.toMatchObject({
      code: "TOOL_SOURCE_UNSUPPORTED",
      sourceKind: "mcp",
      dialect: "unsupported-provider",
    });
    expect(call).not.toHaveBeenCalled();
  });

  it("reports source collisions with structured merge ownership", async () => {
    const first = mcp({
      id: "first-server",
      transport: stdio({ command: "first-server" }),
    });
    const second = mcp({
      id: "second-server",
      transport: stdio({ command: "second-server" }),
    });
    const materializeToolSource = vi.fn(async () => ({
      tools: { lookup: { description: "duplicate" } },
      close: vi.fn(),
    }));
    const call = vi.fn();
    const createCollisionAdapter = adapter({
      providerId: "collision-provider",
      materializeToolSource,
      call,
      mapSettings: () => ({}),
      async stream() {
        throw new Error("stream is not used by this test");
      },
      appendToolRound(messages) {
        return messages;
      },
    });
    const assistant = prompt({
      id: "colliding-tool-sources",
      use: [first, second],
      prompt: "Do not call the provider.",
    });

    await expect(
      createCollisionAdapter({}).generate(assistant, {
        model: "fixture-model",
      }),
    ).rejects.toMatchObject({
      name: "ToolSourceCollisionError",
      code: "TOOL_SOURCE_COLLISION",
      phase: "merge",
      toolName: "lookup",
      sourceId: "second-server",
      previousOwner: 'tool source "first-server"',
    });
    expect(call).not.toHaveBeenCalled();
  });
});
