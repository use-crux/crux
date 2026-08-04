/** Structured pre-acceptance capability failure law. */

import { expect, it } from "vitest";
import type { RunSessionConformanceTestsOptions } from "./types";

export function registerSessionCapabilityConformance(
  options: RunSessionConformanceTestsOptions,
): void {
  it("rejects an unsupported execution capability before Session acceptance", async () => {
    const harness = await options.createHarness("capability-failure");
    try {
      await expect(
        harness.createCapabilityFailure("unsupported-key"),
      ).rejects.toMatchObject({
        code: "GENERATION_CAPABILITY_MISSING",
        whatFailed: expect.any(String),
        why: expect.any(String),
        whatStillWorks: expect.any(String),
        nextStep: expect.any(String),
      });
      await expect(Promise.resolve(harness.sessionCount())).resolves.toBe(0);
    } finally {
      await harness.dispose();
    }
  });
}
