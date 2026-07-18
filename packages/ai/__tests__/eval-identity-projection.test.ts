import { describe, expect, it } from "vitest";
import { projectJson } from "../src/eval-task-identity-projection";

describe("Eval identity JSON projection", () => {
  it("allows shared inert values but rejects actual cycles", () => {
    const shared = { value: "same" };
    expect(projectJson({ left: shared, right: shared })).toEqual({
      ok: true,
      value: {
        left: { value: "same" },
        right: { value: "same" },
      },
    });

    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    expect(projectJson(cycle)).toEqual({
      ok: false,
      reason: "identity_unavailable",
    });
  });
});
