import { describe, expect, it, vi } from "vitest";
import { defer, type CruxDeferError } from "@use-crux/core";
import { runWithDeferInvocation } from "@use-crux/core/internal/scope";
import type { CruxHostBinding } from "@use-crux/core/internal/scope";
import { testBinding } from "./test-binding";

describe("host capability matrix", () => {
  it("rejects inline registration when the binding disables it", async () => {
    const callback = vi.fn();
    const binding: CruxHostBinding = {
      ...testBinding(() => {}),
      supportsInline: false,
      durableFinalization: true,
    };

    await expect(
      runWithDeferInvocation(
        () => {
          defer(callback);
          return "response";
        },
        {
          binding,
          classifyOutcome: () => "success",
        },
      ),
    ).rejects.toMatchObject({
      code: "DEFER_CAPABILITY_MISSING",
    } satisfies Partial<CruxDeferError>);
    expect(callback).not.toHaveBeenCalled();
  });
});
