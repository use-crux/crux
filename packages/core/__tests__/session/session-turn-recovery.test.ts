import { resetHooks } from "@use-crux/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionRecoveryFixture } from "./session-turn-recovery.fixtures";

afterEach(() => resetHooks());

describe("Session turn recovery", () => {
  it("reports one accepted turn and its completed Session lifetime", async () => {
    const fixture = await createSessionRecoveryFixture("status-stats");

    try {
      await expect(fixture.conversation.status()).resolves.toEqual({
        state: "running",
        acceptedCursor: "1",
        pendingInputs: 1,
        pendingWork: 1,
      });
      await expect(fixture.conversation.stats()).resolves.toMatchObject({
        work: {
          total: {
            completed: 0,
            current: { queued: 1, running: 0, blocked: 0 },
          },
        },
      });

      const worker = fixture.startWorker();
      try {
        await expect(fixture.turn.result()).resolves.toEqual({
          reply: "Echo: Hello",
        });
      } finally {
        await worker.stop();
      }

      await expect(fixture.conversation.status()).resolves.toEqual({
        state: "parked",
        acceptedCursor: "1",
        processedCursor: "1",
        pendingInputs: 0,
        pendingWork: 0,
      });
      await expect(fixture.conversation.stats()).resolves.toMatchObject({
        work: {
          total: {
            started: 1,
            completed: 1,
            current: { queued: 0, running: 0, blocked: 0 },
          },
        },
      });
    } finally {
      fixture.host.dispose();
    }
  });

  it("recovers before owner Thread publication", async () => {
    const fixture = await createSessionRecoveryFixture("pre-publication");
    fixture.store.testing.crashAfterSessionTurnCheckpoint();
    const worker = fixture.startWorker();

    try {
      await expectRecoveredOnce(fixture);
    } finally {
      await worker.stop();
      fixture.host.dispose();
    }
  });

  it("replays owner Thread publication after a post-commit crash", async () => {
    const fixture = await createSessionRecoveryFixture("post-publication");
    fixture.store.testing.crashAfterSessionThreadPublication();
    const worker = fixture.startWorker();

    try {
      await expectRecoveredOnce(fixture);
    } finally {
      await worker.stop();
      fixture.host.dispose();
    }
  });

  it("fails safely when a recovered prepared result artifact is unavailable", async () => {
    const fixture = await createSessionRecoveryFixture("missing-artifact");
    fixture.store.testing.crashAfterSessionTurnCheckpoint();
    fixture.store.testing.missingSessionPreparedResultArtifact();
    const worker = fixture.startWorker();

    try {
      await vi.waitFor(async () => {
        await expect(fixture.turn.work.status()).resolves.toMatchObject({
          state: "blocked",
          blockedOn: {
            code: "SESSION_TURN_RESULT_ARTIFACT_UNAVAILABLE",
            message: expect.stringContaining("What still works:"),
          },
        });
      });
      const status = await fixture.turn.work.status();
      expect(status).not.toMatchObject({
        blockedOn: { message: expect.stringContaining("Hello") },
      });
      await expect(fixture.conversation.status()).resolves.toEqual({
        state: "blocked",
        acceptedCursor: "1",
        pendingInputs: 0,
        pendingWork: 1,
      });
      await expect(fixture.conversation.stats()).resolves.toMatchObject({
        work: {
          total: {
            started: 1,
            completed: 0,
            current: { queued: 0, running: 0, blocked: 1 },
          },
        },
      });
      expect(fixture.execute).toHaveBeenCalledOnce();
      expect(fixture.provider).toHaveBeenCalledTimes(2);
      expect(fixture.tool).toHaveBeenCalledOnce();
      expect(fixture.effectHandler).toHaveBeenCalledOnce();
    } finally {
      await worker.stop();
      fixture.host.dispose();
    }
  });
});

async function expectRecoveredOnce(
  fixture: Awaited<ReturnType<typeof createSessionRecoveryFixture>>,
): Promise<void> {
  await expect(fixture.turn.result()).resolves.toEqual({
    reply: "Echo: Hello",
  });
  expect({
    executor: fixture.execute.mock.calls.length,
    provider: fixture.provider.mock.calls.length,
    tool: fixture.tool.mock.calls.length,
    effect: fixture.effectHandler.mock.calls.length,
  }).toMatchObject({
    executor: 1,
    provider: 2,
    tool: 1,
    effect: 1,
  });
  await expect(fixture.conversation.thread.read()).resolves.toMatchObject({
    entries: [
      expect.objectContaining({ role: "user", content: "Hello" }),
      expect.objectContaining({ role: "assistant" }),
      expect.objectContaining({ role: "tool", content: "tool-result" }),
      expect.objectContaining({
        role: "assistant",
        content: [{ type: "text", text: '{"reply":"Echo: Hello"}' }],
      }),
    ],
  });
  const receipts = await fixture.records.list(
    `thread/${fixture.conversation.thread.id}/receipt/`,
  );
  expect(receipts.entries).toHaveLength(1);
  await expect(fixture.turn.work.status()).resolves.toMatchObject({
    state: "completed",
  });
  expect(
    fixture.store.testing.sessionRecord(
      fixture.namespace,
      fixture.conversation.id,
    ),
  ).toMatchObject({ wakePending: false });
  await expect(fixture.conversation.status()).resolves.toEqual({
    state: "parked",
    acceptedCursor: "1",
    processedCursor: "1",
    pendingInputs: 0,
    pendingWork: 0,
  });
  await expect(fixture.conversation.stats()).resolves.toMatchObject({
    work: {
      total: {
        started: 1,
        completed: 1,
        current: { queued: 0, running: 0, blocked: 0 },
      },
    },
  });
}
