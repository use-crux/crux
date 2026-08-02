import { describe, expect, expectTypeOf, it } from "vitest";
import { createInternalWorkOwnerPort } from "../../src/work/internal/owner-retained-work";
import { createProcessLocalWorkKernel } from "../../src/work/internal/process-local-kernel";
import { projectProcessLocalWork } from "../../src/work/internal/public-projection";

describe("process-local public Work projection", () => {
  it("projects exact status, result, and detach behavior without exposing the owner registry", async () => {
    let finish!: (value: { readonly answer: 42 }) => void;
    const result = new Promise<{ readonly answer: 42 }>((resolve) => {
      finish = resolve;
    });
    const kernel = createProcessLocalWorkKernel({
      createId: () => "work_agent_child",
      schedule: (start) => start(),
    });
    const owner = createInternalWorkOwnerPort(kernel);
    const reference = await owner.spawnAndRetain(
      { run: () => result },
      {
        kind: "cancellation-only",
        targetId: "agent:researcher",
        targetLabel: "researcher",
      },
    );

    const work = projectProcessLocalWork(owner, reference);
    expect(work).toBeDefined();
    if (!work)
      throw new Error("Expected the originating owner to project Work.");
    expectTypeOf(work.result()).toEqualTypeOf<
      Promise<{ readonly answer: 42 }>
    >();
    expect(Object.keys(work)).toEqual([
      "id",
      "targetId",
      "effects",
      "status",
      "result",
      "cancel",
      "detach",
    ]);
    expect(work).not.toHaveProperty("lookup");
    expect(work).not.toHaveProperty("list");
    await expect(work.status()).resolves.toMatchObject({
      id: "work_agent_child",
      targetId: "agent:researcher",
      state: "running",
    });

    finish({ answer: 42 });
    await expect(work.result()).resolves.toEqual({ answer: 42 });
    const completed = await work.status();
    expect(completed).toMatchObject({
      state: "completed",
      result: { answer: 42 },
    });
    expect(Object.isFrozen(completed)).toBe(true);

    await expect(work.detach()).resolves.toEqual({ detached: true });
    expect(owner.lookup(work.id)).toBeUndefined();
    await expect(work.result()).resolves.toEqual({ answer: 42 });
  });

  it("keeps cooperative cancellation distinct from detaching the owner", async () => {
    const ids = ["work_cancelled_child", "work_detached_child"];
    const kernel = createProcessLocalWorkKernel({
      createId: () => ids.shift() ?? "unexpected_work",
      schedule: (start) => start(),
    });
    const owner = createInternalWorkOwnerPort(kernel);
    let markCancelledStarted!: () => void;
    const cancelledStarted = new Promise<void>((resolve) => {
      markCancelledStarted = resolve;
    });
    const cancelledReference = await owner.spawnAndRetain(
      {
        run: async (context) => {
          markCancelledStarted();
          return new Promise<never>((_resolve, reject) => {
            context.signal.addEventListener(
              "abort",
              () => reject(context.signal.reason),
              { once: true },
            );
          });
        },
      },
      {
        kind: "cancellation-only",
        targetId: "agent:cancelled",
        targetLabel: "cancelled",
      },
    );
    const cancelled = projectProcessLocalWork(owner, cancelledReference);
    if (!cancelled) throw new Error("Expected cancellable Work projection.");
    await cancelledStarted;

    await expect(cancelled.cancel({ reason: "stop" })).resolves.toEqual({
      cancelled: true,
    });
    expect(owner.lookup(cancelled.id)).toBeDefined();
    await expect(cancelled.result()).rejects.toBeInstanceOf(DOMException);
    await expect(cancelled.status()).resolves.toMatchObject({
      state: "cancelled",
    });

    let detachedSignal!: AbortSignal;
    let finishDetached!: () => void;
    const detachedResult = new Promise<"finished">((resolve) => {
      finishDetached = () => resolve("finished");
    });
    const detachedReference = await owner.spawnAndRetain(
      {
        async run(context) {
          detachedSignal = context.signal;
          return detachedResult;
        },
      },
      {
        kind: "cancellation-only",
        targetId: "agent:detached",
        targetLabel: "detached",
      },
    );
    const detached = projectProcessLocalWork(owner, detachedReference);
    if (!detached) throw new Error("Expected detachable Work projection.");

    await expect(detached.detach()).resolves.toEqual({ detached: true });
    expect(owner.lookup(detached.id)).toBeUndefined();
    expect(detachedSignal.aborted).toBe(false);
    finishDetached();
    await expect(detached.result()).resolves.toBe("finished");
  });
});
