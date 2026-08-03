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

  it("retries an interrupted delivery boundary before preparation exactly once", async () => {
    const fixture = await createSessionRecoveryFixture("delivery-crash");
    fixture.store.testing.crashAfterSessionIngressDelivery();
    const worker = fixture.startWorker();

    try {
      await expectRecoveredOnce(fixture, { executor: 2 });
      expect(fixture.prepareStep).toHaveBeenCalledTimes(2);
    } finally {
      await worker.stop();
      fixture.host.dispose();
    }
  });

  it("inspects the exact prepared Thread basis and request decisions", async () => {
    const fixture = await createSessionRecoveryFixture("prepared-inspection");
    fixture.store.testing.crashAfterSessionTurnCheckpoint();
    const worker = fixture.startWorker();

    try {
      const work = await fixture.turn.work();
      await vi.waitFor(async () => {
        await expect(fixture.conversation.inspect()).resolves.toMatchObject({
          checkpoint: {
            inputId: fixture.turn.id,
            workId: work.id,
            thread: {
              revision: expect.any(String),
              range: expect.any(String),
              offset: 0,
              length: 0,
            },
            requestIds: [expect.any(String), expect.any(String)],
          },
        });
      });
      await expectRecoveredOnce(fixture);
      expect(fixture.prepareStep).toHaveBeenCalledTimes(2);
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

  it("delivers mid-step input before preparation at the next provider boundary", async () => {
    const first = deferred();
    const second = deferred();
    const fixture = await createSessionRecoveryFixture("step-boundary", {
      beforeProvider: async (call) => {
        if (call === 1) await first.pause();
        if (call === 2) await second.pause();
      },
    });
    const worker = fixture.startWorker();

    try {
      await first.started;
      const later = await fixture.conversation.send({ message: "Later" });
      first.release();
      await second.started;

      expect(JSON.stringify(fixture.prepareStep.mock.calls[1]?.[0])).toContain(
        "Later",
      );
      const [initialWork, laterWork] = await Promise.all([
        fixture.turn.work(),
        later.work(),
      ]);
      expect(laterWork.id).toBe(initialWork.id);
      await expect(fixture.conversation.inspect()).resolves.toMatchObject({
        inputs: [
          {
            id: fixture.turn.id,
            workId: initialWork.id,
            delivery: { stepIndex: 0, reason: "initial" },
          },
          {
            id: later.id,
            workId: initialWork.id,
            delivery: { stepIndex: 1, reason: "tool-result" },
          },
        ],
      });
      const replayedBoundary = await fixture.store.sessions.claimStepInputs({
        namespace: fixture.namespace,
        sessionId: fixture.conversation.id,
        inputId: fixture.turn.id,
        workId: initialWork.id,
        stepIndex: 1,
        reason: "tool-result",
        now: new Date(),
      });
      expect(replayedBoundary.inputs.map((input) => input.inputId)).toEqual([
        later.id,
      ]);

      second.release();
      await expect(fixture.turn.result()).resolves.toEqual({
        reply: "Echo: Hello",
      });
      await expect(later.result()).resolves.toEqual({ reply: "Echo: Hello" });
      expect(fixture.provider).toHaveBeenCalledTimes(2);
      await expect(fixture.conversation.inspect()).resolves.toMatchObject({
        inputs: [
          { id: fixture.turn.id, checkpointPrepared: true },
          { id: later.id, checkpointPrepared: true },
        ],
      });
      await expect(fixture.conversation.thread.read()).resolves.toMatchObject({
        entries: expect.arrayContaining([
          expect.objectContaining({ role: "user", content: "Hello" }),
          expect.objectContaining({ role: "user", content: "Later" }),
        ]),
      });
    } finally {
      first.release();
      second.release();
      await worker.stop();
      fixture.host.dispose();
    }
  });

  it("starts terminal-step ingress in the next activation without losing its wake", async () => {
    const first = deferred();
    const fixture = await createSessionRecoveryFixture("terminal-boundary", {
      terminalFirst: true,
      beforeProvider: async (call) => {
        if (call === 1) await first.pause();
      },
    });
    const worker = fixture.startWorker();

    try {
      await first.started;
      const later = await fixture.conversation.send({ message: "Later" });
      first.release();
      await expect(fixture.turn.result()).resolves.toEqual({
        reply: "Echo: Hello",
      });
      await vi.waitFor(async () => {
        const counts = await fixture.store.state.countWork({
          namespace: fixture.namespace,
        });
        expect(counts.reduce((total, count) => total + count.count, 0)).toBe(2);
      });
      await expect(later.result()).resolves.toEqual({ reply: "Echo: Later" });
      expect((await later.work()).id).not.toBe((await fixture.turn.work()).id);
      expect(fixture.provider).toHaveBeenCalledTimes(2);
    } finally {
      first.release();
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
        await expect(
          (await fixture.turn.work()).status(),
        ).resolves.toMatchObject({
          state: "blocked",
          blockedOn: {
            code: "SESSION_TURN_RESULT_ARTIFACT_UNAVAILABLE",
            message: expect.stringContaining("What still works:"),
          },
        });
      });
      const status = await (await fixture.turn.work()).status();
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

function deferred() {
  let markStarted!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    started,
    pause: () => {
      markStarted();
      return released;
    },
    release,
  };
}

async function expectRecoveredOnce(
  fixture: Awaited<ReturnType<typeof createSessionRecoveryFixture>>,
  expected: { readonly executor?: number } = {},
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
    executor: expected.executor ?? 1,
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
  await expect((await fixture.turn.work()).status()).resolves.toMatchObject({
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
