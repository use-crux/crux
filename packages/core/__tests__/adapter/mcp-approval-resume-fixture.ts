import { mcp, stdio } from "@use-crux/mcp";
import { vi } from "vitest";
import { z } from "zod";

import { adapter } from "../../src/adapter/define-adapter";
import type { AdapterResponse, ToolResultEntry } from "../../src/adapter/types";
import type { Message } from "../../src/generation/messages";
import { prompt } from "../../src/prompt/prompt";
import { appendToolApprovalResponse } from "../../src/tools/approvals";
import { toolMiddleware } from "../../src/tools/middleware";
import type { JsonValue } from "../../src/types/tool";
import { withToolSourceReplayIdentity } from "../../src/tools/tool-source";

export const stableMcpReplayIdentity = {
  kind: "mcp",
  serverId: "approval-server",
  remoteName: "lookup",
  exposedName: "server_lookup",
  inputSchemaFingerprint: "sha256:stable-schema",
} as const;

export function createMcpApprovalResumeFixture(options?: {
  readonly identities?: readonly (JsonValue | undefined)[];
  readonly toolNames?: readonly string[];
}) {
  const source = mcp({
    id: "approval-server",
    transport: stdio({ command: "fixture-server" }),
    tools: { prefix: "server_" },
  });
  const executions: number[] = [];
  const closes: number[] = [];
  const middlewareCalls: string[] = [];
  let materializations = 0;

  const materializeToolSource = vi.fn(async () => {
    materializations += 1;
    const session = materializations;
    const toolName = options?.toolNames?.[session - 1] ?? "server_lookup";
    const identity =
      options?.identities?.[session - 1] ?? stableMcpReplayIdentity;
    const tool = {
      description: "Look up a record.",
      parameters: z.object({ id: z.string() }),
      execute: async () => {
        executions.push(session);
        return { found: true };
      },
    };
    return {
      tools:
        toolName === ""
          ? {}
          : {
              [toolName]:
                identity === undefined
                  ? tool
                  : withToolSourceReplayIdentity(tool, identity),
            },
      close: async () => {
        closes.push(session);
      },
    };
  });
  const createAdapter = adapter({
    providerId: "mcp-approval-fixture",
    materializeToolSource,
    mapSettings: () => ({}),
    async call(_client, args) {
      const resumed = args.messages.some(
        (message) =>
          message.role === "tool" &&
          message.metadata?.toolCallId === "approval-call-1",
      );
      return {
        raw: { resumed },
        extracted: resumed
          ? response("approved tool completed")
          : response("approval required", [
              {
                id: "approval-call-1",
                name: "server_lookup",
                args: { id: "record-1" },
              },
            ]),
      };
    },
    async stream() {
      throw new Error("stream is not used by this fixture");
    },
    appendToolRound,
  });
  const assistant = prompt({
    id: "mcp-approval-resume",
    use: [source],
    prompt: "Use the lookup tool.",
    toolMiddleware: toolMiddleware({
      id: "record-resumed-call",
      match: ["server_lookup"],
      beforeExecute: ({ toolCallId }) => middlewareCalls.push(toolCallId),
    }),
  });
  const client = createAdapter({});

  return {
    closes,
    executions,
    materializeToolSource,
    middlewareCalls,
    suspend: () =>
      client.generate(assistant, {
        model: "fixture-model",
        toolApproval: { server_lookup: "always" },
      }),
    resume: (
      suspended: Awaited<ReturnType<typeof client.generate>>,
      messages: Message[] = approvedMessages(suspended),
    ) =>
      client.generate(assistant, {
        model: "fixture-model",
        toolApproval: { server_lookup: "always" },
        messages,
      }),
  };
}

export function approvedMessages(
  suspended: Awaited<ReturnType<ReturnType<typeof adapter>["generate"]>>,
): Message[] {
  const request = suspended.pendingApprovals![0]!;
  return appendToolApprovalResponse(suspended.messages, {
    approvalId: request.approvalId,
    approved: true,
    approvalToken: request.approvalToken,
  }) as Message[];
}

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

function appendToolRound(
  messages: Message[],
  assistant: AdapterResponse,
  results: ToolResultEntry[],
): Message[] {
  return [
    ...messages,
    {
      role: "assistant",
      content: assistant.text,
      metadata: { toolCalls: assistant.toolCalls },
    },
    ...results.map(
      (result): Message => ({
        role: "tool",
        content: result.content,
        metadata: { toolCallId: result.toolCallId, toolName: result.name },
      }),
    ),
  ];
}
