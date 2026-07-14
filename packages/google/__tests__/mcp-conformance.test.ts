import type { GoogleGenAI } from "@google/genai";
import { beforeEach, vi } from "vitest";
import { prompt } from "@use-crux/core";
import { materializeMcpToolSource, mcp, streamableHttp } from "@use-crux/mcp";
import { describeMcpAdapterConformance } from "@use-crux/mcp/testing/vitest";
import { z } from "zod";

import { createGoogle } from "../src";

vi.mock("@use-crux/mcp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@use-crux/mcp")>()),
  materializeMcpToolSource: vi.fn(),
}));

const materializeMock = vi.mocked(materializeMcpToolSource);
const source = mcp({
  id: "google-conformance",
  transport: streamableHttp({ url: "https://mcp.example.test" }),
});

beforeEach(() => {
  materializeMock.mockReset();
});

describeMcpAdapterConformance("Google", {
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
    const result = await createGoogle(
      googleClient(calls, "tool-loop"),
    ).generate(mcpPrompt(), { model: "gemini-conformance" });

    return {
      materializeCount: materializeMock.mock.calls.length,
      exposedToolNames: googleToolNames(calls[0]),
      executions,
      closeCount: close.mock.calls.length,
      text: result.text,
    };
  },

  async invokeOrdinary() {
    await createGoogle(googleClient([], "ordinary")).generate(
      prompt({ id: "google-ordinary", prompt: "Answer directly." }),
      { model: "gemini-conformance" },
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
      await createGoogle(googleClient([], "failure")).generate(mcpPrompt(), {
        model: "gemini-conformance",
      });
    } catch {
      rejected = true;
    }
    return { rejected, closeCount: close.mock.calls.length };
  },
});

function mcpPrompt() {
  return prompt({
    id: "google-mcp-conformance",
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

function googleClient(
  calls: unknown[],
  scenario: "tool-loop" | "ordinary" | "failure",
): GoogleGenAI {
  let turn = 0;
  return {
    models: {
      generateContent: async (request: unknown) => {
        calls.push(request);
        if (scenario === "failure") throw new Error("provider unavailable");
        turn += 1;
        if (scenario === "ordinary" || turn > 1)
          return googleResponse([{ text: "done" }]);
        return googleResponse([
          { functionCall: { name: "lookup", args: { query: "crux" } } },
        ]);
      },
    },
  } as unknown as GoogleGenAI;
}

function googleToolNames(request: unknown): string[] {
  if (typeof request !== "object" || request === null || !("config" in request))
    return [];
  const config = request.config;
  if (typeof config !== "object" || config === null || !("tools" in config))
    return [];
  const groups = Array.isArray(config.tools) ? config.tools : [];
  return groups.flatMap((group) => {
    if (
      typeof group !== "object" ||
      group === null ||
      !("functionDeclarations" in group) ||
      !Array.isArray(group.functionDeclarations)
    )
      return [];
    return (group.functionDeclarations as unknown[]).flatMap((declaration) =>
      typeof declaration === "object" &&
      declaration !== null &&
      "name" in declaration &&
      typeof declaration.name === "string"
        ? [declaration.name]
        : [],
    );
  });
}

function googleResponse(parts: readonly unknown[]) {
  const textPart = parts.find(
    (part) => typeof part === "object" && part !== null && "text" in part,
  );
  const text =
    textPart && "text" in textPart && typeof textPart.text === "string"
      ? textPart.text
      : undefined;
  return {
    candidates: [
      {
        content: { parts, role: "model" },
        finishReason: text ? "STOP" : "TOOL_CALL",
      },
    ],
    usageMetadata: {
      promptTokenCount: 1,
      candidatesTokenCount: 1,
      totalTokenCount: 2,
    },
    text,
  };
}
