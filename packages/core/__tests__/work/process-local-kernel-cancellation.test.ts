import { expect, it, vi } from "vitest";
import { createProcessLocalWorkKernel } from "../../src/work/internal/process-local-kernel";

it("commits process-local cancellation state before aborting and only acknowledges owned aborts", async () => {
  const starts: Array<() => void> = [];
  const kernel = createProcessLocalWorkKernel({
    createId: (() => {
      let id = 0;
      return () => `work-${++id}`;
    })(),
    schedule: (start) => starts.push(start),
  });
  let queuedRuns = 0;
  const queued = await kernel.spawn({
    async run() {
      queuedRuns += 1;
      return "never";
    },
  });
  queued.cancel();
  expect((await queued.status()).state).toBe("cancelled");
  starts.shift()?.();
  await expect(queued.result()).rejects.toBeDefined();
  expect(queuedRuns).toBe(0);

  let rejectOwned!: (reason: unknown) => void;
  const owned = await kernel.spawn({
    run({ signal }) {
      return new Promise<never>((_, reject) => {
        rejectOwned = reject;
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    },
  });
  starts.shift()?.();
  await vi.waitFor(async () =>
    expect((await owned.status()).state).toBe("running"),
  );
  owned.cancel();
  expect((await owned.status()).state).toBe("cancel-requested");
  await expect(owned.result()).rejects.toBeDefined();
  expect((await owned.status()).state).toBe("cancelled");
  expect(rejectOwned).toBeTypeOf("function");

  let fail!: () => void;
  const unrelated = await kernel.spawn({
    run() {
      return new Promise<never>((_, reject) => {
        fail = () => reject(new Error("ordinary failure"));
      });
    },
  });
  starts.shift()?.();
  await vi.waitFor(async () =>
    expect((await unrelated.status()).state).toBe("running"),
  );
  unrelated.cancel();
  expect((await unrelated.status()).state).toBe("cancel-requested");
  fail();
  await expect(unrelated.result()).rejects.toThrow("ordinary failure");
  expect((await unrelated.status()).state).toBe("failed");

  let complete!: () => void;
  const completing = await kernel.spawn({
    run() {
      return new Promise<string>((resolve) => {
        complete = () => resolve("completed after cancellation request");
      });
    },
  });
  starts.shift()?.();
  await vi.waitFor(async () =>
    expect((await completing.status()).state).toBe("running"),
  );
  completing.cancel();
  expect((await completing.status()).state).toBe("cancel-requested");
  complete();
  await expect(completing.result()).rejects.toBeDefined();
  expect((await completing.status()).state).toBe("cancelled");
});

it("cancels queued work when a parent aborts without invoking the driver", async () => {
  const starts: Array<() => void> = [];
  const kernel = createProcessLocalWorkKernel({
    createId: (() => {
      let id = 0;
      return () => `work-${++id}`;
    })(),
    schedule: (start) => starts.push(start),
  });
  const parent = new AbortController();
  let queuedRuns = 0;
  const queued = await kernel.spawn(
    {
      async run() {
        queuedRuns += 1;
        return "never";
      },
    },
    {
      kind: "attached",
      attachment: { parentId: "parent-work", signal: parent.signal },
    },
  );
  parent.abort();
  expect((await queued.status()).state).toBe("cancelled");
  await expect(queued.result()).rejects.toBeDefined();
  expect(queuedRuns).toBe(0);
  expect(starts).toHaveLength(1);
});

it("marks running work cancelled when a parent aborts even if the driver resolves", async () => {
  const starts: Array<() => void> = [];
  const kernel = createProcessLocalWorkKernel({
    createId: (() => {
      let id = 0;
      return () => `work-${++id}`;
    })(),
    schedule: (start) => starts.push(start),
  });
  const parent = new AbortController();
  let complete!: () => void;
  const work = await kernel.spawn(
    {
      run() {
        return new Promise<string>((resolve) => {
          complete = () => resolve("completed despite parent abort");
        });
      },
    },
    {
      kind: "attached",
      attachment: { parentId: "parent-work", signal: parent.signal },
    },
  );
  starts.shift()?.();
  await vi.waitFor(async () =>
    expect((await work.status()).state).toBe("running"),
  );
  parent.abort();
  expect((await work.status()).state).toBe("cancel-requested");
  complete();
  await expect(work.result()).rejects.toBeDefined();
  expect((await work.status()).state).toBe("cancelled");
});

it("detaches from a parent so a later parent abort cannot cancel running work", async () => {
  const starts: Array<() => void> = [];
  const kernel = createProcessLocalWorkKernel({
    createId: (() => {
      let id = 0;
      return () => `work-${++id}`;
    })(),
    schedule: (start) => starts.push(start),
  });

  let complete!: () => void;
  const parent = new AbortController();
  const detached = await kernel.spawn(
    {
      run() {
        return new Promise<string>((resolve) => {
          complete = () => resolve("completed after detach");
        });
      },
    },
    {
      kind: "attached",
      attachment: { parentId: "parent-work", signal: parent.signal },
    },
  );
  starts.shift()?.();
  await vi.waitFor(async () =>
    expect((await detached.status()).state).toBe("running"),
  );
  expect(detached.detachFromParent()).toBe(true);
  parent.abort();
  complete();
  await expect(detached.result()).resolves.toBe("completed after detach");
  expect((await detached.status()).state).toBe("completed");

  let finish!: () => void;
  const cancelledParent = new AbortController();
  const refused = await kernel.spawn(
    {
      run() {
        return new Promise<string>((resolve) => {
          finish = () => resolve("completed despite parent abort");
        });
      },
    },
    {
      kind: "attached",
      attachment: { parentId: "parent-work", signal: cancelledParent.signal },
    },
  );
  starts.shift()?.();
  await vi.waitFor(async () =>
    expect((await refused.status()).state).toBe("running"),
  );
  cancelledParent.abort();
  expect(refused.detachFromParent()).toBe(false);
  finish();
  await expect(refused.result()).rejects.toBeDefined();
  expect((await refused.status()).state).toBe("cancelled");
});
