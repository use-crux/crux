import type Anthropic from "@anthropic-ai/sdk";
import { beforeEach, vi } from "vitest";
import { prompt } from "@use-crux/core";
import { materializeMcpToolSource, mcp, streamableHttp } from "@use-crux/mcp";
import { describeMcpAdapterConformance } from "@use-crux/mcp/testing/vitest";
import { z } from "zod";

import { createAnthropic } from "../src";

vi.mock("@use-crux/mcp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@use-crux/mcp")>()),
  materializeMcpToolSource: vi.fn(),
}));

const materializeMock = vi.mocked(materializeMcpToolSource);
const source = mcp({
  id: "anthropic-conformance",
  transport: streamableHttp({ url: "https://mcp.example.test" }),
});

beforeEach(() => {
  materializeMock.mockReset();
});

describeMcpAdapterConformance("Anthropic", {
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
    const result = await createAnthropic(
      anthropicClient(calls, "tool-loop"),
    ).generate(mcpPrompt(), { model: "claude-conformance" });

    return {
      materializeCount: materializeMock.mock.calls.length,
      exposedToolNames: anthropicToolNames(calls[0]),
      executions,
      closeCount: close.mock.calls.length,
      text: result.text,
    };
  },

  async invokeOrdinary() {
    await createAnthropic(anthropicClient([], "ordinary")).generate(
      prompt({ id: "anthropic-ordinary", prompt: "Answer directly." }),
      { model: "claude-conformance" },
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
      await createAnthropic(anthropicClient([], "failure")).generate(
        mcpPrompt(),
        { model: "claude-conformance" },
      );
    } catch {
      rejected = true;
    }
    return { rejected, closeCount: close.mock.calls.length };
  },
});

function mcpPrompt() {
  return prompt({
    id: "anthropic-mcp-conformance",
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

function anthropicClient(
  calls: unknown[],
  scenario: "tool-loop" | "ordinary" | "failure",
): Anthropic {
  let turn = 0;
  return {
    messages: {
      create: async (request: unknown) => {
        calls.push(request);
        if (scenario === "failure") throw new Error("provider unavailable");
        turn += 1;
        if (scenario === "ordinary" || turn > 1)
          return anthropicResponse([{ type: "text", text: "done" }]);
        return anthropicResponse([
          {
            type: "tool_use",
            id: "mcp-call-1",
            name: "lookup",
            input: { query: "crux" },
          },
        ]);
      },
    },
  } as unknown as Anthropic;
}

function anthropicToolNames(request: unknown): string[] {
  if (typeof request !== "object" || request === null || !("tools" in request))
    return [];
  const tools = Array.isArray(request.tools) ? request.tools : [];
  return tools.flatMap((tool) =>
    typeof tool === "object" &&
    tool !== null &&
    "name" in tool &&
    typeof tool.name === "string"
      ? [tool.name]
      : [],
  );
}

function anthropicResponse(content: readonly unknown[]) {
  return {
    id: "msg_mcp_conformance",
    type: "message",
    role: "assistant",
    model: "claude-conformance",
    content,
    stop_reason: content.some(
      (part) =>
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "tool_use",
    )
      ? "tool_use"
      : "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}
