import { describe, expect, it } from "vitest";

import {
  createCommittedApprovalReplayProvenance,
  verifyApprovalReplayCommitment,
} from "../src/adapter/tool/approval-replay";
import type { Message } from "../src/generation/messages";
import type {
  CruxArtifactId,
  CruxRunId,
  CruxSpanId,
  CruxTraceId,
} from "../src/observability";
import { findToolApprovalRequests } from "../src/tools/approvals";

const operationId = "run_111111111111111111111111" as CruxRunId;
const runId = "run_222222222222222222222222" as CruxRunId;
const traceId =
  "11111111111111111111111111111111" as CruxTraceId;
const attemptSpanId = "1111111111111111" as CruxSpanId;
const requestArtifactId =
  "artifact_1111111111111111111111111111111111111111111111111111111111111111" as CruxArtifactId;

const requestFields = {
  approvalId: "approval_call-1",
  toolCallId: "call-1",
  toolName: "lookup",
  input: { id: "1" },
} as const;

const lifecycle = {
  identityEpoch: 1,
  namespace: { operationId, runId },
  attempt: { runId, traceId, spanId: attemptSpanId },
  requestProducer: { runId, traceId, spanId: attemptSpanId },
  requestArtifactId,
  requestEvidence: {
    kind: "execution.evidence",
    id: "evidence_1111111111111111",
    subject: { kind: "execution", id: attemptSpanId },
    role: "authority",
    evidenceKind: "approval.request",
    recordedAt: "2026-07-30T00:00:00.000Z",
  },
} as const;

describe("tool approval replay V2", () => {
  it("commits the exact approved lifecycle field names", () => {
    const replay = createCommittedApprovalReplayProvenance(
      requestFields,
      "fixed-token",
      { kind: "mcp", serverId: "server" },
      [{ kind: "approvalMiddleware", id: "review" }],
      lifecycle,
    );

    expect(Object.keys(replay).sort()).toEqual([
      "attempt",
      "commitment",
      "identityEpoch",
      "namespace",
      "policies",
      "requestArtifactId",
      "requestEvidence",
      "requestProducer",
      "tool",
      "version",
    ]);
    expect(replay).toMatchObject({
      version: 2,
      identityEpoch: 1,
      namespace: { operationId, runId },
      attempt: { runId, traceId, spanId: attemptSpanId },
    });
    expect(
      verifyApprovalReplayCommitment(
        requestFields,
        "fixed-token",
        replay,
      ),
    ).toBe(true);
  });

  it("fails closed when protected lifecycle identity is changed", () => {
    const replay = createCommittedApprovalReplayProvenance(
      requestFields,
      "fixed-token",
      { kind: "mcp", serverId: "server" },
      [],
      lifecycle,
    );

    expect(
      verifyApprovalReplayCommitment(
        requestFields,
        "fixed-token",
        {
          ...replay,
          attempt: {
            ...replay.attempt,
            spanId: "2222222222222222" as CruxSpanId,
          },
        },
      ),
    ).toBe(false);
  });

  it("rejects an authority ref that does not target the committed attempt", () => {
    expect(() =>
      createCommittedApprovalReplayProvenance(
        requestFields,
        "fixed-token",
        { kind: "mcp", serverId: "server" },
        [],
        {
          ...lifecycle,
          requestEvidence: {
            ...lifecycle.requestEvidence,
            subject: {
              kind: "execution",
              id: "2222222222222222" as CruxSpanId,
            },
          },
        },
      ),
    ).toThrow(/request evidence/i);
  });

  it("accepts only the exact closed V2 continuation from message history", () => {
    const replay = createCommittedApprovalReplayProvenance(
      requestFields,
      "fixed-token",
      { kind: "mcp", serverId: "server" },
      [],
      lifecycle,
    );

    expect(findToolApprovalRequests(approvalMessages(replay))).toHaveLength(1);
    expect(
      findToolApprovalRequests(
        approvalMessages({ ...replay, futureField: true }),
      ),
    ).toHaveLength(0);
    expect(
      findToolApprovalRequests(
        approvalMessages({
          ...replay,
          requestEvidence: {
            ...replay.requestEvidence,
            role: "intent",
          },
        }),
      ),
    ).toHaveLength(0);
    expect(
      findToolApprovalRequests(
        approvalMessages({ ...replay, version: 3 }),
      ),
    ).toHaveLength(0);
  });
});

function approvalMessages(replay: unknown): Message[] {
  return [
    {
      role: "assistant",
      content: "",
      metadata: {
        toolCalls: [
          {
            id: requestFields.toolCallId,
            name: requestFields.toolName,
            args: requestFields.input,
          },
        ],
        toolApprovalRequests: [
          {
            ...requestFields,
            approvalToken: "fixed-token",
            replay,
          },
        ],
      },
    },
  ];
}
