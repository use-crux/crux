import { appendToolApprovalResponse, prompt } from "@use-crux/core";
import { withToolSourceReplayIdentity } from "@use-crux/core/tools";
import {
  materializeAiSdkMcpToolSource,
  mcp,
  streamableHttp,
} from "@use-crux/mcp";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCruxAi } from "../src";
import type { SdkGateway } from "../src/gateway";
import { scriptedGateway } from "./scripted-gateway";

vi.mock("@use-crux/mcp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@use-crux/mcp")>()),
  materializeAiSdkMcpToolSource: vi.fn(),
}));

const materializeMock = vi.mocked(materializeAiSdkMcpToolSource);

describe("AI SDK MCP approval resume", () => {
  beforeEach(() => materializeMock.mockReset());

  it("reconnects and joins the approved call to the rediscovered SDK-native tool", async () => {
    const executions: number[] = [];
    const closes: number[] = [];
    materializeMock
      .mockResolvedValueOnce(session(1, executions, closes))
      .mockResolvedValueOnce(session(2, executions, closes));
    const scripted = scriptedGateway({
      generateText: [
        {
          content: [
            {
              type: "tool-approval-request",
              toolCall: {
                toolCallId: "mcp-call-1",
                toolName: "lookup",
                input: { query: "crux" },
              },
            },
          ],
        },
        { text: "done" },
      ],
    });
    let calls = 0;
    const gateway: SdkGateway = {
      ...scripted.gateway,
      async generateText(args) {
        calls += 1;
        if (calls === 1) {
          const tool = (args.tools as Record<string, unknown>).lookup as {
            needsApproval(
              input: unknown,
              options: { toolCallId: string; messages: [] },
            ): Promise<boolean>;
          };
          await tool.needsApproval(
            { query: "crux" },
            { toolCallId: "mcp-call-1", messages: [] },
          );
        }
        return scripted.gateway.generateText(args);
      },
    };
    const assistant = prompt({
      id: "ai-mcp-approval-resume",
      use: [
        mcp({
          id: "ai-approval-server",
          transport: streamableHttp({ url: "https://mcp.example.test" }),
        }),
      ],
      prompt: "Use lookup.",
    });
    const ai = createCruxAi({ gateway });
    const suspended = await ai.generate(assistant, {
      model: "test:model" as never,
      toolApproval: { lookup: "always" },
    });
    const request = suspended.pendingApprovals![0]!;
    expect(request.replay).toBeDefined();
    const resumed = await ai.generate(assistant, {
      model: "test:model" as never,
      toolApproval: { lookup: "always" },
      messages: appendToolApprovalResponse(suspended.messages, {
        approvalId: request.approvalId,
        approved: true,
        approvalToken: request.approvalToken,
      }),
    });

    expect(resumed.text).toBe("done");
    expect(JSON.stringify(resumed.messages)).toContain(
      '"toolCallId":"mcp-call-1"',
    );
    expect(executions).toEqual([2]);
    expect(closes).toEqual([1, 2]);
  });
});

function session(sessionId: number, executions: number[], closes: number[]) {
  return {
    tools: {
      lookup: withToolSourceReplayIdentity(
        {
          description: "lookup",
          inputSchema: { jsonSchema: { type: "object" } },
          execute: async () => {
            executions.push(sessionId);
            return { content: [] };
          },
          toModelOutput: ({ output }: { output: unknown }) => ({
            type: "json" as const,
            value: output,
          }),
        },
        {
          kind: "mcp",
          serverId: "ai-approval-server",
          remoteName: "lookup",
          exposedName: "lookup",
          inputSchemaFingerprint: "sha256:stable",
        },
      ),
    },
    close: async () => closes.push(sessionId),
  } as never;
}
