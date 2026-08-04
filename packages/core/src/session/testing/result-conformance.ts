/** Canonical Work result and failure laws shared by Session adapters. */

import { expect, it } from "vitest";
import type {
  RunSessionConformanceTestsOptions,
  SessionConformanceWorker,
} from "./types";

export function registerSessionResultConformance(
  options: RunSessionConformanceTestsOptions,
): void {
  it("shares one canonical Work and exact safe failure across a claimed prefix", async () => {
    const harness = await options.createHarness("shared-failure");
    let worker: SessionConformanceWorker | undefined;
    try {
      const conversation = await harness.create("failure-key");
      const [first, second] = await conversation.sendMany([
        { message: "private-failure" },
        { message: "joined-failure" },
      ]);
      await harness.makeTerminalFailure();
      worker = await harness.startWorker();
      const [firstWork, secondWork] = await Promise.all([
        first!.work(),
        second!.work(),
      ]);

      expect(secondWork.id).toBe(firstWork.id);
      const failures = await Promise.all([
        captureFailure(first!.result()),
        captureFailure(second!.result()),
        captureFailure(firstWork.result()),
      ]);
      for (const failure of failures) {
        expect(failure).toMatchObject({
          code: "work_failed",
          failure: {
            code: "WORK_DEAD_LETTERED",
            message: "Session conformance failure.",
            retryable: false,
          },
        });
        expect(JSON.stringify(failure)).not.toContain("private-failure");
      }
      expect(harness.executionCounts()).toEqual({
        executor: 1,
        provider: 0,
        tool: 0,
        effect: 0,
      });
    } finally {
      await worker?.stop();
      await harness.dispose();
    }
  });
}

async function captureFailure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    throw new Error("Expected the Session result to fail.");
  } catch (error) {
    return error;
  }
}
