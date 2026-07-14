import type OpenAI from "openai";
import { prompt } from "@use-crux/core";
import {
  boundary,
  constraint,
  guardrail,
  toolPolicy,
} from "@use-crux/core/safety";
import { materializeMcpToolSource, mcp, streamableHttp } from "@use-crux/mcp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createOpenAI } from "../src";

vi.mock("@use-crux/mcp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@use-crux/mcp")>()),
  materializeMcpToolSource: vi.fn(),
}));

const materializeMock = vi.mocked(materializeMcpToolSource);

describe("OpenAI MCP policy conformance", () => {
  beforeEach(() => {
    materializeMock.mockReset();
  });

  it("applies argument policy before the official MCP transport", async () => {
    const execute = vi.fn(async (input: { query: string }) => input);
    materializeMock.mockResolvedValue(session(execute));

    await createOpenAI(openAIClient(["done"])).generate(
      prompt({
        id: "openai-mcp-args-policy",
        use: [mcpSource()],
        prompt: "Use the tool.",
        toolMiddleware: toolPolicy.args({
          id: "trim-query",
          match: "lookup",
          run: async (subject) => ({
            action: "rewrite",
            value: {
              ...subject,
              input: {
                query: (subject.input as { query: string }).query.trim(),
              },
            },
            rewrite: { kind: "normalize" },
          }),
        }),
      }),
      { model: "gpt-4o-policy" },
    );

    expect(execute).toHaveBeenCalledWith(
      { query: "crux" },
      expect.objectContaining({ toolCallId: "mcp-call-1" }),
    );
  });

  it("guards and retries MCP-assisted OpenAI output", async () => {
    const execute = vi.fn(async () => ({ source: "guide" }));
    materializeMock.mockResolvedValue(session(execute));
    const result = await createOpenAI(
      openAIClient(["private claim", "safe claim [1]"]),
    ).generate(
      prompt({
        id: "openai-mcp-output-safety",
        use: [mcpSource()],
        prompt: "Use the tool.",
      }),
      {
        model: "gpt-4o-policy",
        guardrails: [
          guardrail({
            id: "redact-private",
            on: boundary.output.text(),
            run: async (text) => ({
              action: "rewrite",
              value: text.replace("private", "[redacted]"),
              rewrite: { kind: "redact" },
            }),
          }),
        ],
        constraints: [
          constraint({
            id: "require-citation",
            on: boundary.output.text(),
            maxRetries: 1,
            run: async (text) =>
              text.includes("[1]")
                ? { pass: true }
                : { pass: false, feedback: "Add a citation." },
          }),
        ],
      },
    );

    expect(execute).toHaveBeenCalledOnce();
    expect(result.text).toBe("safe claim [1]");
  });
});

function mcpSource() {
  return mcp({
    id: "openai-policy",
    transport: streamableHttp({ url: "https://mcp.example.test" }),
  });
}

function session(execute: (input: { query: string }) => Promise<unknown>) {
  return {
    tools: {
      lookup: {
        description: "Look up a source.",
        parameters: z.object({ query: z.string() }),
        execute,
      },
    },
    close: vi.fn(async () => {}),
  } as never;
}

function openAIClient(finalTexts: string[]): OpenAI {
  let turn = 0;
  return {
    chat: {
      completions: {
        create: async () => {
          turn += 1;
          if (turn === 1) {
            return chatCompletion(null, [
              {
                id: "mcp-call-1",
                type: "function",
                function: {
                  name: "lookup",
                  arguments: JSON.stringify({ query: "  crux  " }),
                },
              },
            ]);
          }
          return chatCompletion(finalTexts.shift() ?? "done");
        },
      },
    },
  } as unknown as OpenAI;
}

function chatCompletion(content: string | null, toolCalls?: unknown[]) {
  return {
    id: "chatcmpl_mcp_policy",
    object: "chat.completion",
    created: 0,
    model: "gpt-4o-policy",
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
