import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createApprovalReplayProvenance } from "../src/adapter/tool/approval-replay";
import { createToolLifecycle } from "../src/adapter/tool/session";
import type { Message } from "../src/generation/messages";
import { toolPolicy } from "../src/safety/toolPolicy";
import { appendToolApprovalResponse } from "../src/tools/approvals";
import { approvalMiddleware } from "../src/tools/middleware";
import { withToolSourceReplayIdentity } from "../src/tools/tool-source";

describe("tool approval replay", () => {
  it("binds canonical request fields with the approval token as an HMAC key", () => {
    const replay = createApprovalReplayProvenance(
      {
        approvalId: "approval_call-1",
        toolCallId: "call-1",
        toolName: "lookup",
        input: { id: "1" },
      },
      "fixed-token",
      { kind: "mcp", serverId: "server" },
      [{ kind: "approvalMiddleware", id: "review" }],
    );
    const canonical =
      '{"approvalId":"approval_call-1","input":{"id":"1"},"policies":[{"id":"review","kind":"approvalMiddleware"}],"tool":{"kind":"mcp","serverId":"server"},"toolCallId":"call-1","toolName":"lookup"}';
    const expected = createHmac("sha256", "fixed-token")
      .update(`crux.tool-approval-replay:v1\0${canonical}`)
      .digest("hex");

    expect(replay.commitment).toBe(expected);
  });

  it("commits every positive middleware identity without leaking toolPolicy implementation details", async () => {
    const lifecycle = replayLifecycle([
      approvalMiddleware({ id: "human-review", match: ["lookup"] }),
      toolPolicy({
        id: "external-data-review",
        match: "lookup",
        action: "requestApproval",
      }),
    ]);

    const round = await lifecycle.executeRound(toolCallResponse(), []);

    expect(round.kind).toBe("suspended");
    if (round.kind !== "suspended") return;
    expect(round.request.replay?.policies).toEqual([
      { kind: "toolPolicy", id: "external-data-review" },
      { kind: "approvalMiddleware", id: "human-review" },
    ]);
  });

  it("invalidates replay when a requesting policy was removed", async () => {
    const initial = replayLifecycle([
      approvalMiddleware({ id: "human-review", match: ["lookup"] }),
      toolPolicy({
        id: "external-data-review",
        match: "lookup",
        action: "requestApproval",
      }),
    ]);
    const round = await initial.executeRound(toolCallResponse(), []);
    expect(round.kind).toBe("suspended");
    if (round.kind !== "suspended") return;
    const messages = appendToolApprovalResponse(round.messages, {
      approvalId: round.request.approvalId,
      approved: true,
      approvalToken: round.request.approvalToken,
    }) as Message[];
    const resumed = replayLifecycle([
      approvalMiddleware({ id: "human-review", match: ["lookup"] }),
    ]);

    const result = await resumed.resume(messages);

    expect(JSON.stringify(result.messages)).toContain("approval-invalid");
    expect(executions).toBe(0);
  });

  it("re-evaluates policy identity on replay without emitting a second request callback", async () => {
    const onRequest = vi.fn();
    const lifecycle = replayLifecycle([
      approvalMiddleware({
        id: "human-review-once",
        match: ["lookup"],
        onRequest,
      }),
    ]);
    const round = await lifecycle.executeRound(toolCallResponse(), []);
    expect(round.kind).toBe("suspended");
    if (round.kind !== "suspended") return;
    const messages = appendToolApprovalResponse(round.messages, {
      approvalId: round.request.approvalId,
      approved: true,
      approvalToken: round.request.approvalToken,
    }) as Message[];

    await lifecycle.resume(messages);

    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(executions).toBe(1);
  });
});

let executions = 0;

function replayLifecycle(
  toolMiddleware: readonly ReturnType<typeof approvalMiddleware>[],
) {
  executions = 0;
  return createToolLifecycle({
    regime: "core",
    resolved: {
      tools: {
        lookup: withToolSourceReplayIdentity(
          {
            description: "lookup",
            execute: async () => {
              executions += 1;
              return "done";
            },
          },
          {
            kind: "mcp",
            serverId: "server",
            remoteName: "lookup",
            exposedName: "lookup",
            inputSchemaFingerprint: "sha256:schema",
          },
        ),
      },
      toolMiddleware,
    },
    promptId: "approval-replay",
  });
}

function toolCallResponse() {
  return {
    text: "",
    toolCalls: [{ id: "call-1", name: "lookup", args: { id: "1" } }],
    finishReason: "tool_calls",
  };
}
