/** Bounded Session inspection and statistics laws. */

import { expect, it } from "vitest";
import type {
  RunSessionConformanceTestsOptions,
  SessionConformanceWorker,
} from "./types";

export function registerSessionInspectionConformance(
  options: RunSessionConformanceTestsOptions,
): void {
  it("bounds payload-free inspection while aggregating one compatible Work", async () => {
    const harness = await options.createHarness("bounded-inspection");
    let worker: SessionConformanceWorker | undefined;
    try {
      const conversation = await harness.create("inspection-key");
      const turns = await conversation.sendMany(
        Array.from({ length: 70 }, (_, index) => ({
          message: `private:${index}`,
        })),
      );
      const inspection = await conversation.inspect();

      expect(inspection.inputs).toHaveLength(64);
      expect(inspection.inputs[0]).toMatchObject({ cursor: "7" });
      expect(inspection.inputs.at(-1)).toMatchObject({ cursor: "70" });
      expect(inspection.coverage).toEqual({
        inputs: "truncated",
        limit: 64,
      });
      expect(JSON.stringify(inspection)).not.toContain("private:");
      await expect(conversation.stats()).resolves.toMatchObject({
        work: {
          total: {
            completed: 0,
            current: { queued: 1, running: 0, blocked: 0 },
          },
        },
      });

      worker = await harness.startWorker();
      await expect(turns[0]!.result()).resolves.toEqual({
        reply: "Echo: private:0",
      });
      await expect(conversation.stats()).resolves.toMatchObject({
        work: {
          total: {
            started: 1,
            completed: 1,
            current: { queued: 0, running: 0, blocked: 0 },
          },
        },
      });
    } finally {
      await worker?.stop();
      await harness.dispose();
    }
  });
}
