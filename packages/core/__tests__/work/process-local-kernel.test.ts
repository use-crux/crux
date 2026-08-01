import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { effect, rollback } from "@use-crux/core/effect";
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

describe("process-local Work kernel", () => {
  it("keeps cancellation-only Work distinct from an attached parent", async () => {
    const kernel = createProcessLocalWorkKernel();
    const controller = new AbortController();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const driver = {
      run: async (context: { readonly attachedParentId?: string; readonly signal: AbortSignal }) => {
        await hold;
        return context;
      },
    };
    const cancellationOnly = await kernel.spawn(
      driver,
      { kind: "cancellation-only", signal: controller.signal },
    );
    const attached = await kernel.spawn(
      driver,
      {
        kind: "attached",
        attachment: { parentId: "parent-work", signal: controller.signal },
      },
    );

    controller.abort("cancelled");
    release();
    const cancellationOnlyContext = await cancellationOnly.result();
    const attachedContext = await attached.result();
    expect(cancellationOnlyContext.attachedParentId).toBeUndefined();
    expect(attachedContext.attachedParentId).toBe("parent-work");
    expect(cancellationOnlyContext.signal.aborted).toBe(true);
    expect(attachedContext.signal.aborted).toBe(true);
  });

  it("joins an inputless Flow with its exact output and one stable Effect scope", async () => {
    const flowStarted = deferred();
    const releaseFlow = deferred();
    const expected = { kind: "work-output", count: 2 } as const;
    const recover = vi.fn(async () => undefined);
    const record = effect("work.tracer.record", async () => undefined, {
      recover,
    });
    const target = flow("internal work tracer", async () => {
      flowStarted.resolve();
      await releaseFlow.promise;
      await record.run();
      return expected;
    });
    let start: (() => void) | undefined;
    let now = 0;
    const kernel = createProcessLocalWorkKernel({
      createId: () => "work_tracer",
      now: () => new Date(++now),
      schedule(run) {
        start = run;
      },
    });

    const handle = await kernel.spawn(createFlowWorkDriver(target));
    expectTypeOf(handle.result()).toEqualTypeOf<Promise<typeof expected>>();
    await expect(handle.status()).resolves.toMatchObject({
      id: "work_tracer",
      state: "queued",
    });

    start?.();
    await flowStarted.promise;
    await expect(handle.status()).resolves.toMatchObject({ state: "running" });
    expect(Object.isFrozen(handle.effects)).toBe(true);

    releaseFlow.resolve();
    await expect(handle.result()).resolves.toBe(expected);
    await expect(handle.status()).resolves.toMatchObject({
      state: "completed",
      resultAvailable: true,
    });
    const rollbackResult = await rollback(handle.effects);
    expect(rollbackResult.units).toEqual([
      expect.objectContaining({
        effectIds: ["work.tracer.record"],
        status: "recovered",
      }),
    ]);
    expect(recover).toHaveBeenCalledOnce();
  });
});
