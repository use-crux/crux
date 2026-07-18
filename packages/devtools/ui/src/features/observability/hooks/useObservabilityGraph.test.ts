import { describe, expect, it } from "vitest";
import { observabilityRunRefetchInterval } from "./useObservabilityGraph";

describe("observability run polling", () => {
  it("stops after Local proves that a run does not exist", () => {
    expect(
      observabilityRunRefetchInterval({
        state: { data: null, dataUpdatedAt: Date.now() },
      }),
    ).toBe(false);
  });
});
