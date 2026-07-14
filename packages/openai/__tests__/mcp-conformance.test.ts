import type OpenAI from "openai";
import { beforeEach, vi } from "vitest";
import { prompt } from "@use-crux/core";
import { materializeMcpToolSource, mcp, streamableHttp } from "@use-crux/mcp";
import { describeMcpAdapterConformance } from "@use-crux/mcp/testing/vitest";
import { z } from "zod";

import { createOpenAI } from "../src";

vi.mock("@use-crux/mcp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@use-crux/mcp")>()),
  materializeMcpToolSource: vi.fn(),
}));

const materializeMock = vi.mocked(materializeMcpToolSource);
const source = mcp({
  id: "openai-conformance",
  transport: streamableHttp({ url: "https://mcp.example.test" }),
});

beforeEach(() => {
  materializeMock.mockReset();
});

describeMcpAdapterConformance("OpenAI", {
  async invokeMcp() {
    const executions: Array<{
      name: string;
      input: Readonly<Record<string, unknown>>;
    }> = [];
    const close = vi.fn(async () => {});
    materializeMock.mockResolvedValue(
      session(close, async (input) => {
        executions.push({ name: "lookup", input });
        return { content: [{ type: "text", text: "from MCP" }] };
      }),
    );
    const calls: unknown[] = [];
    const result = await createOpenAI(
      openAIClient(calls, "tool-loop"),
    ).generate(mcpPrompt(), { model: "gpt-4o-conformance" });

    return {
      materializeCount: materializeMock.mock.calls.length,
      exposedToolNames: openAIToolNames(calls[0]),
      executions,
      closeCount: close.mock.calls.length,
      text: result.text,
    };
  },

  async invokeOrdinary() {
    await createOpenAI(openAIClient([], "ordinary")).generate(
      prompt({ id: "openai-ordinary", prompt: "Answer directly." }),
      { model: "gpt-4o-conformance" },
    );
    return { materializeCount: materializeMock.mock.calls.length };
  },

  async invokeProviderFailure() {
    const close = vi.fn(async () => {});
    materializeMock.mockResolvedValue(
      session(close, async () => ({ content: [] })),
    );
    let rejected = false;
    try {
      await createOpenAI(openAIClient([], "failure")).generate(mcpPrompt(), {
        model: "gpt-4o-conformance",
      });
    } catch {
      rejected = true;
    }
    return { rejected, closeCount: close.mock.calls.length };
  },
});

function mcpPrompt() {
  return prompt({
    id: "openai-mcp-conformance",
    use: [source],
    prompt: "Use the lookup tool.",
  });
}

function session(
  close: () => Promise<void>,
  execute: (input: Record<string, unknown>) => Promise<unknown>,
) {
  return {
    tools: {
      lookup: {
        description: "Look up a value",
        parameters: z.object({ query: z.string() }),
        execute,
      },
    },
    close,
  } as never;
}

function openAIClient(
  calls: unknown[],
  scenario: "tool-loop" | "ordinary" | "failure",
): OpenAI {
  let turn = 0;
  return {
    chat: {
      completions: {
        create: async (request: unknown) => {
          calls.push(request);
          if (scenario === "failure") throw new Error("provider unavailable");
          turn += 1;
          if (scenario === "ordinary" || turn > 1)
            return chatCompletion("done");
          return chatCompletion(null, [
            {
              id: "mcp-call-1",
              type: "function",
              function: {
                name: "lookup",
                arguments: JSON.stringify({ query: "crux" }),
              },
            },
          ]);
        },
      },
    },
  } as unknown as OpenAI;
}

function openAIToolNames(request: unknown): string[] {
  if (typeof request !== "object" || request === null || !("tools" in request))
    return [];
  const tools = Array.isArray(request.tools) ? request.tools : [];
  return tools.flatMap((tool) => {
    if (typeof tool !== "object" || tool === null || !("function" in tool))
      return [];
    const fn = tool.function;
    return typeof fn === "object" &&
      fn !== null &&
      "name" in fn &&
      typeof fn.name === "string"
      ? [fn.name]
      : [];
  });
}

function chatCompletion(content: string | null, toolCalls?: unknown[]) {
  return {
    id: "chatcmpl_mcp_conformance",
    object: "chat.completion",
    created: 0,
    model: "gpt-4o-conformance",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
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
