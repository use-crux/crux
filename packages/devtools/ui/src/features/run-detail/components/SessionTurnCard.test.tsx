import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ObservabilityRunDetailNode } from "@/types";
import { SessionTurnCard } from "./SessionTurnCard";

describe("SessionTurnCard", () => {
  it("renders bounded lineage and recovery evidence from a closed allowlist", () => {
    const node = {
      primitive: "session.turn",
      attributes: {
        outcome: "blocked",
        prompt: "PRIVATE_PROMPT_SENTINEL",
        session: {
          schema: 1,
          identity: {
            sessionId: "session-42",
            keyHash: "key-fingerprint",
            targetId: "support",
            threadId: "thread-42",
            credentials: "PRIVATE_CREDENTIAL_SENTINEL",
          },
          status: {
            state: "blocked",
            acceptedCursor: "4",
            processedCursor: "3",
            pendingInputs: 1,
            pendingWork: 1,
          },
          wakePending: false,
          thread: { revision: "thread-revision" },
          inputs: [
            {
              inputId: "input-4",
              cursor: "4",
              state: "blocked",
              workId: "work-4",
              checkpointPrepared: true,
              delivery: {
                stepIndex: 1,
                reason: "tool-result",
                deliveredAt: "2026-08-04T12:00:00.000Z",
                arguments: "PRIVATE_ARGUMENT_SENTINEL",
              },
              payload: "PRIVATE_INPUT_SENTINEL",
            },
          ],
          checkpoint: {
            inputId: "input-4",
            workId: "work-4",
            checkpointedAt: "2026-08-04T12:00:01.000Z",
            thread: {
              revision: "basis-revision",
              range: "empty",
              offset: 0,
              length: 0,
            },
            requestCount: 2,
            requestCoverage: "complete",
            requestIds: ["PRIVATE_PROVIDER_ID_SENTINEL"],
          },
          recovery: {
            code: "SESSION_TURN_RESULT_ARTIFACT_UNAVAILABLE",
            nextStep: "Restore the result store, then retry the turn.",
          },
          coverage: { inputs: "complete", limit: 64 },
          stats: {
            work: {
              total: {
                started: 1,
                completed: 0,
                current: { queued: 0, running: 0, blocked: 1 },
              },
            },
            modelCalls: { started: 2, succeeded: 1, failed: 1 },
            failures: { total: 1 },
            reasoning: "PRIVATE_REASONING_SENTINEL",
          },
          output: "PRIVATE_OUTPUT_SENTINEL",
        },
      },
    } as unknown as ObservabilityRunDetailNode;

    const html = renderToStaticMarkup(<SessionTurnCard node={node} />);
    for (const value of [
      "Session turn",
      "blocked",
      "session-42",
      "support",
      "thread-42",
      "thread-revision",
      "Accepted cursor",
      "4",
      "input-4",
      "work-4",
      "tool-result",
      "basis-revision",
      "2 requests",
      "SESSION_TURN_RESULT_ARTIFACT_UNAVAILABLE",
      "Restore the result store, then retry the turn.",
      "1 blocked",
    ]) {
      expect(html).toContain(value);
    }
    expect(html).not.toMatch(
      /PRIVATE_PROMPT_SENTINEL|PRIVATE_CREDENTIAL_SENTINEL|PRIVATE_ARGUMENT_SENTINEL|PRIVATE_INPUT_SENTINEL|PRIVATE_PROVIDER_ID_SENTINEL|PRIVATE_REASONING_SENTINEL|PRIVATE_OUTPUT_SENTINEL/,
    );
  });
});
