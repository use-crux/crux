import { resetHooks } from "@use-crux/core";
import { executeRuntimeBridgeCommand } from "@use-crux/core/runtime-bridge";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../../src/observability";
import { afterEach, describe, expect, it } from "vitest";
import { clearInspectableResources } from "../../src/runtime-bridge/resources";
import { createSessionRecoveryFixture } from "./session-turn-recovery.fixtures";

afterEach(() => {
  clearInspectableResources();
  resetObservabilityRuntime();
  resetHooks();
});

describe("Session devtools read model", () => {
  it("serializes bounded identity, lineage, checkpoint, and statistics evidence", async () => {
    const fixture = await createSessionRecoveryFixture("devtools-bridge");
    const worker = fixture.startWorker();

    try {
      await fixture.turn.result();
      const work = await fixture.turn.work();
      const result = await executeRuntimeBridgeCommand(
        {},
        {
          type: "command.request",
          commandId: "cmd_session",
          command: "store.read",
          payload: {
            operation: "get",
            resource: `session:${encodeURIComponent(fixture.conversation.id)}`,
          },
        },
      );

      expect(result).toMatchObject({
        schema: 1,
        identity: {
          sessionId: fixture.conversation.id,
          keyHash: expect.any(String),
          targetId: "session-turn-recovery-devtools-bridge",
          targetKind: "agent",
          threadId: fixture.conversation.thread.id,
        },
        status: {
          state: "parked",
          acceptedCursor: "1",
          processedCursor: "1",
          pendingInputs: 0,
          pendingWork: 0,
        },
        subscriptions: [],
        thread: { revision: expect.any(String) },
        inputs: [
          {
            inputId: fixture.turn.id,
            cursor: "1",
            state: "completed",
            workId: work.id,
            checkpointPrepared: true,
            delivery: {
              stepIndex: 0,
              reason: "initial",
              deliveredAt: expect.any(String),
            },
          },
        ],
        checkpoint: {
          inputId: fixture.turn.id,
          workId: work.id,
          checkpointedAt: expect.any(String),
          thread: {
            revision: expect.any(String),
            range: expect.any(String),
          },
          requestCount: 2,
          requestCoverage: "complete",
        },
        coverage: { inputs: "complete", limit: 64 },
        stats: {
          modelCalls: { started: 0 },
          work: { total: { completed: 1 } },
        },
      });
      expect(JSON.stringify(result)).not.toMatch(
        /Hello|customer-recovery-devtools-bridge|recover-1|effect-result|tool-result/,
      );
    } finally {
      await worker.stop();
      fixture.host.dispose();
    }
  });

  it("records the same payload-safe projection on the canonical Session turn run", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const fixture = await createSessionRecoveryFixture("run-detail");
    const worker = fixture.startWorker();

    try {
      await fixture.turn.result();
      const work = await fixture.turn.work();
      await observe.flush();

      const start = transport.records.find(
        (record) =>
          record.type === "run:start" &&
          record.rootPrimitive === "session.turn",
      );
      const end = transport.records.find(
        (record) => record.type === "run:end" && record.runId === start?.runId,
      );

      expect(start).toMatchObject({
        sessionId: fixture.conversation.id,
        attributes: {
          sessionId: fixture.conversation.id,
          inputId: fixture.turn.id,
          workId: work.id,
          cursor: "1",
          threadId: fixture.conversation.thread.id,
        },
      });
      expect(end).toMatchObject({
        status: "ok",
        attributes: {
          outcome: "completed",
          session: {
            schema: 1,
            status: { state: "parked", processedCursor: "1" },
            thread: { revision: expect.any(String) },
            inputs: [
              {
                inputId: fixture.turn.id,
                workId: work.id,
                state: "completed",
              },
            ],
            checkpoint: {
              workId: work.id,
              requestCount: 2,
            },
          },
        },
      });
      expect(JSON.stringify([start, end])).not.toMatch(
        /Hello|customer-recovery-run-detail|recover-1|effect-result|tool-result/,
      );
    } finally {
      await worker.stop();
      fixture.host.dispose();
    }
  });
});
