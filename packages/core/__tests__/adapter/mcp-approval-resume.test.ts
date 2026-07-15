import { describe, expect, it } from "vitest";

import {
  approvedMessages,
  createMcpApprovalResumeFixture,
  stableMcpReplayIdentity,
} from "./mcp-approval-resume-fixture";

describe("MCP approval resume", () => {
  it("closes on suspension, reconnects, and executes only the unchanged approved call", async () => {
    const fixture = createMcpApprovalResumeFixture();
    const suspended = await fixture.suspend();
    const request = suspended.pendingApprovals?.[0];

    expect(request?.replay).toEqual({
      version: 1,
      tool: stableMcpReplayIdentity,
      policies: [
        {
          kind: "declaration",
          layer: "call",
          key: "server_lookup",
          policyKind: "always",
        },
      ],
      commitment: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(fixture.executions).toEqual([]);
    expect(fixture.closes).toEqual([1]);

    const resumed = await fixture.resume(suspended);

    expect(resumed.text).toBe("approved tool completed");
    expect(fixture.materializeToolSource).toHaveBeenCalledTimes(2);
    expect(fixture.executions).toEqual([2]);
    expect(fixture.middlewareCalls).toEqual(["approval-call-1"]);
    expect(fixture.closes).toEqual([1, 2]);
  });

  it("settles a disappeared tool as approval-invalid without execution", async () => {
    const fixture = createMcpApprovalResumeFixture({
      toolNames: ["server_lookup", ""],
    });
    const suspended = await fixture.suspend();
    const resumed = await fixture.resume(suspended);
    const result = resumed.messages.find(
      (message) =>
        message.role === "tool" &&
        message.metadata?.toolCallId === "approval-call-1",
    );

    expect(fixture.executions).toEqual([]);
    expect(result?.content).toContain(
      "The approved tool request changed and was not executed. Request approval again.",
    );
    expect(fixture.closes).toEqual([1, 2]);
  });

  it("invalidates approval when the rediscovered input schema changes", async () => {
    const fixture = createMcpApprovalResumeFixture({
      identities: [
        stableMcpReplayIdentity,
        {
          ...stableMcpReplayIdentity,
          inputSchemaFingerprint: "sha256:changed-schema",
        },
      ],
    });
    const suspended = await fixture.suspend();
    const resumed = await fixture.resume(suspended);
    const result = resumed.messages.find(
      (message) => message.metadata?.toolCallId === "approval-call-1",
    );

    expect(fixture.executions).toEqual([]);
    expect(result?.content).toContain("approval-invalid");
  });

  it("invalidates approval when the remote name changes behind the same exposed name", async () => {
    const fixture = createMcpApprovalResumeFixture({
      identities: [
        stableMcpReplayIdentity,
        { ...stableMcpReplayIdentity, remoteName: "replacement_lookup" },
      ],
    });
    const suspended = await fixture.suspend();
    const resumed = await fixture.resume(suspended);

    expect(fixture.executions).toEqual([]);
    expect(JSON.stringify(resumed.messages)).toContain("approval-invalid");
  });

  it("invalidates approval when the exposed name identity changes", async () => {
    const fixture = createMcpApprovalResumeFixture({
      identities: [
        stableMcpReplayIdentity,
        { ...stableMcpReplayIdentity, exposedName: "renamed_lookup" },
      ],
    });
    const suspended = await fixture.suspend();
    const resumed = await fixture.resume(suspended);

    expect(fixture.executions).toEqual([]);
    expect(JSON.stringify(resumed.messages)).toContain("approval-invalid");
  });

  it("invalidates approval when durable request arguments drift", async () => {
    const fixture = createMcpApprovalResumeFixture();
    const suspended = await fixture.suspend();
    const messages = mutateApprovalRequest(
      approvedMessages(suspended),
      (request) => ({
        ...request,
        input: { id: "different-record" },
      }),
    );
    const resumed = await fixture.resume(suspended, messages);

    expect(fixture.executions).toEqual([]);
    expect(JSON.stringify(resumed.messages)).toContain("approval-invalid");
  });

  it("invalidates approval when the durable tool call ID drifts", async () => {
    const fixture = createMcpApprovalResumeFixture();
    const suspended = await fixture.suspend();
    const messages = mutateApprovalRequest(
      approvedMessages(suspended),
      (request) => ({
        ...request,
        toolCallId: "different-call",
      }),
    );
    const resumed = await fixture.resume(suspended, messages);

    expect(fixture.executions).toEqual([]);
    expect(JSON.stringify(resumed.messages)).toContain("approval-invalid");
  });

  it("settles an approval token mismatch with the fixed safe error", async () => {
    const fixture = createMcpApprovalResumeFixture();
    const suspended = await fixture.suspend();
    const messages = approvedMessages(suspended).map((message) =>
      message.metadata?.toolApprovalResponse
        ? {
            ...message,
            metadata: {
              ...message.metadata,
              toolApprovalResponse: {
                ...message.metadata.toolApprovalResponse,
                approvalToken: "forged-token",
              },
            },
          }
        : message,
    );
    const resumed = await fixture.resume(suspended, messages);

    expect(fixture.executions).toEqual([]);
    expect(JSON.stringify(resumed.messages)).toContain(
      "The approved tool request changed and was not executed. Request approval again.",
    );
  });
});

function mutateApprovalRequest(
  messages: readonly import("../../src/generation/messages").Message[],
  mutate: (request: Record<string, unknown>) => Record<string, unknown>,
) {
  return messages.map((message) => {
    const requests = message.metadata?.toolApprovalRequests;
    if (!requests?.length) return message;
    return {
      ...message,
      metadata: {
        ...message.metadata,
        toolApprovalRequests: requests.map((request) =>
          mutate(request as unknown as Record<string, unknown>),
        ),
      },
    };
  });
}
