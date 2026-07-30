import { afterEach, describe, expect, it } from "vitest";

import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../../src/observability";
import { appendToolApprovalResponse } from "../../src/tools/approvals";
import {
  approvedMessages,
  createMcpApprovalResumeFixture,
  stableMcpReplayIdentity,
} from "./mcp-approval-resume-fixture";

describe("MCP approval resume", () => {
  afterEach(() => resetObservabilityRuntime());

  it("closes on suspension, reconnects, and executes only the unchanged approved call", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const fixture = createMcpApprovalResumeFixture();
    const suspended = await fixture.suspend();
    const request = suspended.pendingApprovals?.[0];

    expect(request?.replay).toMatchObject({
      version: 2,
      identityEpoch: 1,
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
      namespace: {
        operationId: expect.stringMatching(/^run_/),
        runId: expect.stringMatching(/^run_/),
      },
      attempt: {
        runId: expect.stringMatching(/^run_/),
        traceId: expect.stringMatching(/^[0-9a-f]{32}$/),
        spanId: expect.stringMatching(/^[0-9a-f]{16}$/),
      },
      requestProducer: {
        runId: expect.stringMatching(/^run_/),
        traceId: expect.stringMatching(/^[0-9a-f]{32}$/),
        spanId: expect.stringMatching(/^[0-9a-f]{16}$/),
      },
      requestArtifactId: expect.stringMatching(/^artifact_[0-9a-f]{64}$/),
      requestEvidence: {
        kind: "execution.evidence",
        role: "authority",
        evidenceKind: "approval.request",
      },
    });
    expect(fixture.executions).toEqual([]);
    expect(fixture.closes).toEqual([1]);

    const resumed = await fixture.resume(suspended);

    expect(resumed.text).toBe("approved tool completed");
    expect(fixture.materializeToolSource).toHaveBeenCalledTimes(2);
    expect(fixture.executions).toEqual([2]);
    expect(fixture.middlewareCalls).toEqual(["approval-call-1"]);
    expect(fixture.closes).toEqual([1, 2]);
    await observe.flush();

    if (request?.replay?.version !== 2) {
      throw new Error("Expected a committed approval replay.");
    }
    const calls = transport.records.filter(
      (record) =>
        record.type === "span:start" &&
        record.primitive === "tool.call" &&
        record.attributes?.toolCallId === request.toolCallId,
    );
    expect(calls).toHaveLength(2);
    const resumedCall = calls.find(
      (record) => record.spanId !== request.replay.attempt.spanId,
    );
    expect(resumedCall).toBeDefined();
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "edge",
        edgeType: "triggered",
        from: {
          kind: "span",
          id: request.replay.attempt.spanId,
        },
        to: { kind: "span", id: resumedCall?.spanId },
      }),
    );

    const decisionArtifact = transport.records.find(
      (record) =>
        record.type === "artifact" &&
        record.kind === "approval.decision",
    );
    expect(decisionArtifact).toMatchObject({
      contentType: "application/json",
      encoding: "json",
      preview: { status: "approved" },
      attributes: {
        approvalOccurrence: expect.objectContaining({
          domain: "crux.tool.approval",
          identityEpoch: 1,
          namespace: request.replay.namespace,
          approvalId: request.approvalId,
          slot: "decision",
        }),
      },
    });
    if (decisionArtifact?.type !== "artifact") return;

    const authority = transport.records.filter(
      (record) =>
        record.type === "edge" &&
        record.edgeType === "evidence.for" &&
        record.attributes.role === "authority" &&
        record.from.id === decisionArtifact.artifactId,
    );
    expect(authority).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          to: {
            kind: "span",
            id: request.replay.attempt.spanId,
          },
          attributes: expect.objectContaining({
            conclusion: "allowed",
            supersedesEvidenceIds: [request.replay.requestEvidence.id],
          }),
        }),
        expect.objectContaining({
          to: { kind: "span", id: resumedCall?.spanId },
          attributes: expect.objectContaining({
            conclusion: "allowed",
          }),
        }),
      ]),
    );
    expect(authority).toHaveLength(2);
    const decisionIndex = transport.records.indexOf(decisionArtifact);
    expect(
      Math.min(...authority.map((record) => transport.records.indexOf(record))),
    ).toBeGreaterThan(decisionIndex);
  });

  it("records a committed denial without opening an execution call", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const fixture = createMcpApprovalResumeFixture();
    const suspended = await fixture.suspend();
    const request = suspended.pendingApprovals?.[0];
    if (!request || request.replay?.version !== 2) {
      throw new Error("Expected a committed approval replay.");
    }
    const denied = appendToolApprovalResponse(suspended.messages, {
      approvalId: request.approvalId,
      approvalToken: request.approvalToken,
      approved: false,
      reason: "Operator declined",
    });

    await fixture.resume(suspended, denied);
    await observe.flush();

    expect(fixture.executions).toEqual([]);
    expect(
      transport.records.filter(
        (record) =>
          record.type === "span:start" &&
          record.primitive === "tool.call" &&
          record.attributes?.toolCallId === request.toolCallId,
      ),
    ).toHaveLength(1);
    const decision = transport.records.find(
      (record) =>
        record.type === "artifact" &&
        record.kind === "approval.decision",
    );
    expect(decision).toMatchObject({
      preview: { status: "denied" },
    });
    if (decision?.type !== "artifact") return;
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "edge",
        edgeType: "evidence.for",
        from: { kind: "artifact", id: decision.artifactId },
        to: {
          kind: "span",
          id: request.replay.attempt.spanId,
        },
        attributes: expect.objectContaining({
          role: "authority",
          conclusion: "denied",
          supersedesEvidenceIds: [request.replay.requestEvidence.id],
        }),
      }),
    );
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
