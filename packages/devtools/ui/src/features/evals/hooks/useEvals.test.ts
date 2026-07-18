import { describe, expect, it } from "vitest";
import { evalRunRefetchInterval } from "./useEvals";

describe("evalRunRefetchInterval", () => {
  it("stops polling after an authoritative run-detail error", () => {
    expect(
      evalRunRefetchInterval(
        new Error("HTTP 404 for /api/eval/runs/missing"),
      ),
    ).toBe(false);
  });

  it("keeps persisted run detail fresh while reads succeed", () => {
    expect(evalRunRefetchInterval(null)).toBe(2_000);
  });
});
