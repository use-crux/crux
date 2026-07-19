import { describe, expect, it, vi } from "vitest";
import {
  defer,
  runWithExecutionContext,
  type CruxDeferError,
} from "@use-crux/core";

describe("defer()", () => {
  it("throws DEFER_SCOPE_REQUIRED before invoking a callback without a scope", () => {
    const callback = vi.fn();

    expect(() => defer(callback)).toThrow(
      expect.objectContaining<Partial<CruxDeferError>>({
        code: "DEFER_SCOPE_REQUIRED",
      }),
    );
    expect(callback).not.toHaveBeenCalled();
  });

  it("throws DEFER_CAPABILITY_MISSING in a scope without a binding capability", () => {
    const callback = vi.fn();

    expect(() =>
      runWithExecutionContext({ sessionId: "session-1" }, () =>
        defer(callback),
      ),
    ).toThrow(
      expect.objectContaining<Partial<CruxDeferError>>({
        code: "DEFER_CAPABILITY_MISSING",
      }),
    );
    expect(callback).not.toHaveBeenCalled();
  });
});
