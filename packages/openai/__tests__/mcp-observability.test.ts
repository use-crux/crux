import type OpenAI from "openai";
import {
  createInMemoryObservabilityTransport,
  mcpServerDefinitionRef,
  observe,
  prompt,
  resetObservabilityRuntime,
  setObservabilityTransport,
  toolDefinitionRef,
  withToolSourceProvenance,
} from "@use-crux/core";
import { materializeMcpToolSource, mcp, streamableHttp } from "@use-crux/mcp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createOpenAI } from "../src";

vi.mock("@use-crux/mcp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@use-crux/mcp")>()),
  materializeMcpToolSource: vi.fn(),
}));

const materializeMock = vi.mocked(materializeMcpToolSource);

describe("OpenAI MCP observability", () => {
  beforeEach(() => materializeMock.mockReset());
  afterEach(() => resetObservabilityRuntime());

  it("preserves MCP server and ordinary tool refs through the provider loop", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const source = mcp({
      id: "openai-observed-server",
      transport: streamableHttp({ url: "https://mcp.example.test" }),
    });
    const serverRef = mcpServerDefinitionRef(source.id);
    const toolRef = toolDefinitionRef("lookup");
    materializeMock.mockImplementation(async () => {
      const discover = observe.openSpan({
        name: source.id,
        primitive: "mcp.discover",
        attributes: { sourceId: source.id },
        definitionRefs: [serverRef],
      });
      discover.end({ attributes: { exposedToolCount: 1 } });
      return {
        tools: {
          lookup: withToolSourceProvenance(
            {
              description: "Look up a value",
              parameters: z.object({ query: z.string() }),
              execute: async () => ({ value: 42 }),
            },
            {
              attributes: {
                sourceKind: "mcp",
                sourceId: source.id,
                remoteName: "lookup",
                exposedName: "lookup",
              },
              definitionRefs: [serverRef, toolRef],
              causedBySpanIds: [discover.spanId],
            },
          ),
        },
        close: async () => {},
      } as never;
    });

    await createOpenAI(toolLoopClient()).generate(
      prompt({
        id: "openai-observed-mcp",
        use: [source],
        prompt: "Look it up.",
      }),
      { model: "gpt-observed" },
    );
    await observe.flush();

    const call = transport.records.find(
      (record) =>
        record.type === "span:start" && record.primitive === "tool.call",
    );
    expect(call).toMatchObject({
      attributes: expect.objectContaining({
        sourceId: source.id,
        exposedName: "lookup",
      }),
      definitionRefs: expect.arrayContaining([serverRef, toolRef]),
    });
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "edge",
        edgeType: "caused",
        to: { kind: "span", id: call && "spanId" in call ? call.spanId : "" },
      }),
    );
  });
});

function toolLoopClient(): OpenAI {
  let turn = 0;
  return {
    chat: {
      completions: {
        create: async () => {
          turn += 1;
          return completion(
            turn === 1
              ? [
                  {
                    id: "call-1",
                    type: "function",
                    function: {
                      name: "lookup",
                      arguments: JSON.stringify({ query: "crux" }),
                    },
                  },
                ]
              : undefined,
          );
        },
      },
    },
  } as unknown as OpenAI;
}

function completion(toolCalls?: unknown[]) {
  return {
    id: "chatcmpl-observed",
    object: "chat.completion",
    created: 0,
    model: "gpt-observed",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: toolCalls ? null : "done",
          refusal: null,
          ...(toolCalls ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: toolCalls ? "tool_calls" : "stop",
        logprobs: null,
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}
