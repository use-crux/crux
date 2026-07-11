import { afterEach, describe, expect, it, vi } from "vitest";
import { defer } from "@use-crux/core";
import { __setAlsForTesting } from "@use-crux/core/observability";
import {
  runWithDeferInvocation,
  type DeferLifetimeCapability,
} from "@use-crux/core/internal/defer-host";

describe("defer without AsyncLocalStorage", () => {
  afterEach(() => {
    __setAlsForTesting("auto");
  });

  it("supports synchronous registration and rejects async propagation deterministically", async () => {
    __setAlsForTesting(null);
    let scheduled: (() => Promise<void>) | undefined;
    const callback = vi.fn();
    const lifetime: DeferLifetimeCapability = {
      completion: "handler-returned",
      limits: {
        maxDrainMs: 1_000,
        maxCallbacks: 10,
        concurrency: 1,
        maxNestingDepth: 2,
      },
      durableFinalization: false,
      schedule(task) {
        scheduled = () => task.run();
      },
    };
    const options = {
      lifetime,
      classifyOutcome: () => "success" as const,
    };

    await runWithDeferInvocation(() => defer(callback), options);
    await scheduled?.();
    expect(callback).toHaveBeenCalledOnce();

    await expect(
      runWithDeferInvocation(async () => {
        await Promise.resolve();
        defer(() => {});
      }, options),
    ).rejects.toEqual(
      expect.objectContaining({ code: "DEFER_SCOPE_REQUIRED" }),
    );
  });
});
