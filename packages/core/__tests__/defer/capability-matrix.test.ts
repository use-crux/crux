import { describe, expect, it, vi } from "vitest";
import { defer, type CruxDeferError } from "@use-crux/core";
import { runWithDeferInvocation } from "@use-crux/core/internal/defer-host";
import type { DeferLifetimeCapability } from "@use-crux/core/internal/defer-host";
import { testLifetime } from "./test-lifetime";

describe("host capability matrix", () => {
  it("rejects inline registration when the lifetime marks supportsInline false", async () => {
    const callback = vi.fn();
    const lifetime: DeferLifetimeCapability = {
      ...testLifetime(() => {}),
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
          lifetime,
          classifyOutcome: () => "success",
        },
      ),
    ).rejects.toMatchObject({
      code: "DEFER_CAPABILITY_MISSING",
    } satisfies Partial<CruxDeferError>);
    expect(callback).not.toHaveBeenCalled();
  });
});
