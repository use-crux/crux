import { describe, expect, it } from "vitest";
import { flow } from "../../src/flow";
import { createFlowWorkDriver } from "../../src/work/internal/flow-driver";
import { createProcessLocalWorkKernel } from "../../src/work/internal/process-local-kernel";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe("process-local Work status timestamps", () => {
  it("isolates lifecycle snapshots from consumers and a reused clock Date", async () => {
    const flowStarted = deferred();
    const releaseFlow = deferred();
    const sharedClock = new Date(1_000);
    const target = flow("work status timestamp isolation", async () => {
      flowStarted.resolve();
      await releaseFlow.promise;
      return "done";
    });
    let start: (() => void) | undefined;
    const kernel = createProcessLocalWorkKernel({
      createId: () => "work_status_timestamp_isolation",
      now: () => sharedClock,
      schedule(run) {
        start = run;
      },
    });

    const handle = await kernel.spawn(createFlowWorkDriver(target));
    const queued = await handle.status();
    if (queued.state !== "queued") throw new Error("Expected queued Work.");
    expect(queued.acceptedAt.getTime()).toBe(1_000);
    expect(queued.updatedAt.getTime()).toBe(1_000);
    expect(new Set([queued.acceptedAt, queued.updatedAt]).size).toBe(2);
    expect(queued.acceptedAt).not.toBe(sharedClock);
    expect(queued.updatedAt).not.toBe(sharedClock);

    queued.acceptedAt.setTime(9_000);
    queued.updatedAt.setTime(9_001);
    expect(sharedClock.getTime()).toBe(1_000);
    const queuedAgain = await handle.status();
    if (queuedAgain.state !== "queued") throw new Error("Expected queued Work.");
    expect(queuedAgain.acceptedAt.getTime()).toBe(1_000);
    expect(queuedAgain.updatedAt.getTime()).toBe(1_000);
    expect(queuedAgain.acceptedAt).not.toBe(queued.acceptedAt);
    expect(queuedAgain.updatedAt).not.toBe(queued.updatedAt);

    sharedClock.setTime(2_000);
    start?.();
    await flowStarted.promise;
    const running = await handle.status();
    if (running.state !== "running") throw new Error("Expected running Work.");
    expect(running.acceptedAt.getTime()).toBe(1_000);
    expect(running.startedAt.getTime()).toBe(2_000);
    expect(running.updatedAt.getTime()).toBe(2_000);
    expect(
      new Set([running.acceptedAt, running.startedAt, running.updatedAt]).size,
    ).toBe(3);
    expect(running.acceptedAt).not.toBe(sharedClock);
    expect(running.startedAt).not.toBe(sharedClock);
    expect(running.updatedAt).not.toBe(sharedClock);

    running.acceptedAt.setTime(9_100);
    running.startedAt.setTime(9_200);
    running.updatedAt.setTime(9_201);
    expect(sharedClock.getTime()).toBe(2_000);
    const runningAgain = await handle.status();
    if (runningAgain.state !== "running") throw new Error("Expected running Work.");
    expect(runningAgain.acceptedAt.getTime()).toBe(1_000);
    expect(runningAgain.startedAt.getTime()).toBe(2_000);
    expect(runningAgain.updatedAt.getTime()).toBe(2_000);
    expect(runningAgain.acceptedAt).not.toBe(queuedAgain.acceptedAt);

    sharedClock.setTime(3_000);
    releaseFlow.resolve();
    await expect(handle.result()).resolves.toBe("done");
    const completed = await handle.status();
    if (completed.state !== "completed") {
      throw new Error("Expected completed Work.");
    }
    expect(completed.acceptedAt.getTime()).toBe(1_000);
    expect(completed.startedAt.getTime()).toBe(2_000);
    expect(completed.completedAt.getTime()).toBe(3_000);
    expect(completed.updatedAt.getTime()).toBe(3_000);
    expect(
      new Set([
        completed.acceptedAt,
        completed.startedAt,
        completed.completedAt,
        completed.updatedAt,
      ]).size,
    ).toBe(4);
    expect(completed.acceptedAt).not.toBe(sharedClock);
    expect(completed.startedAt).not.toBe(sharedClock);
    expect(completed.completedAt).not.toBe(sharedClock);
    expect(completed.updatedAt).not.toBe(sharedClock);

    completed.acceptedAt.setTime(9_300);
    completed.startedAt.setTime(9_400);
    completed.completedAt.setTime(9_500);
    completed.updatedAt.setTime(9_501);
    const completedAgain = await handle.status();
    if (completedAgain.state !== "completed") {
      throw new Error("Expected completed Work.");
    }
    expect(completedAgain.acceptedAt.getTime()).toBe(1_000);
    expect(completedAgain.startedAt.getTime()).toBe(2_000);
    expect(completedAgain.completedAt.getTime()).toBe(3_000);
    expect(completedAgain.updatedAt.getTime()).toBe(3_000);
    expect(completedAgain.acceptedAt).not.toBe(completed.acceptedAt);
    expect(completedAgain.startedAt).not.toBe(completed.startedAt);
    expect(completedAgain.completedAt).not.toBe(completed.completedAt);
    expect(completedAgain.updatedAt).not.toBe(completed.updatedAt);
    expect(completedAgain.acceptedAt).not.toBe(runningAgain.acceptedAt);
    expect(completedAgain.startedAt).not.toBe(runningAgain.startedAt);
    expect(queuedAgain.acceptedAt.getTime()).toBe(1_000);
    expect(queuedAgain.updatedAt.getTime()).toBe(1_000);
    expect(runningAgain.acceptedAt.getTime()).toBe(1_000);
    expect(runningAgain.startedAt.getTime()).toBe(2_000);
    expect(runningAgain.updatedAt.getTime()).toBe(2_000);
  });
});
