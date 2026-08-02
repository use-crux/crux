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
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
  });
  starts.shift()?.();
  await vi.waitFor(async () => expect((await owned.status()).state).toBe("running"));
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
  await vi.waitFor(async () => expect((await unrelated.status()).state).toBe("running"));
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
  await vi.waitFor(async () => expect((await completing.status()).state).toBe("running"));
  completing.cancel();
  expect((await completing.status()).state).toBe("cancel-requested");
  complete();
  await expect(completing.result()).resolves.toBe("completed after cancellation request");
  expect((await completing.status()).state).toBe("completed");
});
