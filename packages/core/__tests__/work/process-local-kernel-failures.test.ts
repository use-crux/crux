import { describe, expect, it } from "vitest";
import { runPassiveEffectBoundary } from "../../src/effect/internal/boundary";
import { createProcessLocalWorkKernel } from "../../src/work/internal/process-local-kernel";

describe("process-local Work failure lifecycle", () => {
  it("records a safe terminal status when the driver rejects", async () => {
    const failure = { secret: "raw driver failure" };
    let now = 0;
    const kernel = createProcessLocalWorkKernel({
      createId: () => "work_driver_failure",
      now: () => new Date(++now),
      schedule: (start) => start(),
    });

    const handle = await kernel.spawn({
      async run() {
        throw failure;
      },
    });

    await expect(handle.result()).rejects.toBe(failure);
    const status = await handle.status();
    expect(status).toMatchObject({
      id: "work_driver_failure",
      state: "failed",
      acceptedAt: new Date(1),
      startedAt: new Date(2),
      failedAt: new Date(3),
      updatedAt: new Date(3),
    });
    expect(status).not.toHaveProperty("error");
    expect(Object.values(status)).not.toContain(failure);
  });

  it(
    "rejects and releases its registry id when boundary allocation fails",
    async () => {
      const failure = new Error("boundary allocation failed");
      let boundaryRuns = 0;
      const runEffectBoundary: typeof runPassiveEffectBoundary = (
        runId,
        run,
        existingRef,
      ) => {
        boundaryRuns += 1;
        if (boundaryRuns === 1) return Promise.reject(failure);
        return runPassiveEffectBoundary(runId, run, existingRef);
      };
      const kernel = createProcessLocalWorkKernel({
        createId: () => "work_reused_after_allocation_failure",
        schedule: (start) => start(),
        runEffectBoundary,
      });
      const driver = {
        async run() {
          return "done" as const;
        },
      };

      await expect(kernel.spawn(driver)).rejects.toBe(failure);

      const handle = await kernel.spawn(driver);
      await expect(handle.result()).resolves.toBe("done");
      expect(handle.id).toBe("work_reused_after_allocation_failure");
    },
    1_000,
  );
});
