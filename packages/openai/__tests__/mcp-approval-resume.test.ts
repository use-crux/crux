import type OpenAI from "openai";
import { appendToolApprovalResponse, prompt } from "@use-crux/core";
import { withToolSourceReplayIdentity } from "@use-crux/core/tools";
import { materializeMcpToolSource, mcp, streamableHttp } from "@use-crux/mcp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createOpenAI } from "../src";

vi.mock("@use-crux/mcp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@use-crux/mcp")>()),
  materializeMcpToolSource: vi.fn(),
}));

const materializeMock = vi.mocked(materializeMcpToolSource);

describe("OpenAI MCP approval resume", () => {
  beforeEach(() => materializeMock.mockReset());

  it("reconnects and executes the approved call through the rediscovered tool", async () => {
    const executions: number[] = [];
    const closes: number[] = [];
    materializeMock
      .mockResolvedValueOnce(session(1, executions, closes))
      .mockResolvedValueOnce(session(2, executions, closes));
    const assistant = prompt({
      id: "openai-mcp-approval-resume",
      use: [
        mcp({
          id: "openai-approval-server",
          transport: streamableHttp({ url: "https://mcp.example.test" }),
        }),
      ],
      prompt: "Use lookup.",
    });
    const openai = createOpenAI(openAIClient());
    const suspended = await openai.generate(assistant, {
      model: "gpt-4o-approval",
      toolApproval: { lookup: "always" },
    });
    const request = suspended.pendingApprovals![0]!;

    expect(request.replay).toBeDefined();
    expect(executions).toEqual([]);
    expect(closes).toEqual([1]);

    const resumed = await openai.generate(assistant, {
      model: "gpt-4o-approval",
      toolApproval: { lookup: "always" },
      messages: appendToolApprovalResponse(suspended.messages, {
        approvalId: request.approvalId,
        approved: true,
        approvalToken: request.approvalToken,
      }),
    });

    expect(resumed.text).toBe("done");
    expect(executions).toEqual([2]);
    expect(closes).toEqual([1, 2]);
  });
});

function session(sessionId: number, executions: number[], closes: number[]) {
  return {
    tools: {
      lookup: withToolSourceReplayIdentity(
        {
          description: "Look up a value.",
          parameters: z.object({ query: z.string() }),
          execute: async () => {
            executions.push(sessionId);
            return { content: [] };
          },
        },
        {
          kind: "mcp",
          serverId: "openai-approval-server",
          remoteName: "lookup",
          exposedName: "lookup",
          inputSchemaFingerprint: "sha256:stable",
        },
      ),
    },
    close: async () => closes.push(sessionId),
  } as never;
}

function openAIClient(): OpenAI {
  let turn = 0;
  return {
    chat: {
      completions: {
        create: async () => {
          turn += 1;
          return turn === 1
            ? chatCompletion(null, [
                {
                  id: "mcp-call-1",
                  type: "function",
                  function: {
                    name: "lookup",
                    arguments: JSON.stringify({ query: "crux" }),
                  },
                },
              ])
            : chatCompletion("done");
        },
      },
    },
  } as unknown as OpenAI;
}

function chatCompletion(content: string | null, toolCalls?: unknown[]) {
  return {
    id: "chatcmpl_mcp_approval",
    object: "chat.completion",
    created: 0,
    model: "gpt-4o-approval",
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
