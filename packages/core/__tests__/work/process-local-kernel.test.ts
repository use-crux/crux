import { describe, expect, expectTypeOf, it } from "vitest";
import { flow } from "../../src/flow";
import type { EffectScopeRef } from "../../src/effect";
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
  it("joins an inputless Flow with its exact output and one stable Effect scope", async () => {
    const flowStarted = deferred();
    const releaseFlow = deferred();
    const expected = { kind: "work-output", count: 2 } as const;
    const target = flow("internal work tracer", async () => {
      flowStarted.resolve();
      await releaseFlow.promise;
      return expected;
    });
    const flowDriver = createFlowWorkDriver(target);
    let executionEffects: EffectScopeRef | undefined;
    const driver: typeof flowDriver = {
      async run(context) {
        executionEffects = context.effects;
        return flowDriver.run(context);
      },
    };
    let start: (() => void) | undefined;
    let now = 0;
    const kernel = createProcessLocalWorkKernel({
      createId: () => "work_tracer",
      now: () => new Date(++now),
      schedule(run) {
        start = run;
      },
    });

    const handle = await kernel.spawn(driver);
    expectTypeOf(handle.result()).toEqualTypeOf<Promise<typeof expected>>();
    await expect(handle.status()).resolves.toMatchObject({
      id: "work_tracer",
      state: "queued",
    });

    start?.();
    await flowStarted.promise;
    await expect(handle.status()).resolves.toMatchObject({ state: "running" });
    expect(executionEffects).toBe(handle.effects);
    expect(Object.isFrozen(handle.effects)).toBe(true);

    releaseFlow.resolve();
    await expect(handle.result()).resolves.toBe(expected);
    await expect(handle.status()).resolves.toMatchObject({
      state: "completed",
      resultAvailable: true,
    });
  });
});
