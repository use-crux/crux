import { afterEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import type { DeferLifetimeCapability } from "@use-crux/core/internal/defer-host";
import { createInvocationDeferScope } from "../../src/defer/internal/invocation-scope";

describe("invocation defer scope", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("settles at the drain deadline and aborts its cooperative signal", async () => {
    vi.useFakeTimers();
    let scheduled: (() => Promise<void>) | undefined;
    const lifetime: DeferLifetimeCapability = {
      completion: "handler-returned",
      limits: {
        maxDrainMs: 50,
        maxCallbacks: 10,
        concurrency: 1,
        maxNestingDepth: 2,
      },
      durableFinalization: false,
      schedule(task) {
        scheduled = () => task.run();
      },
    };
    const scope = createInvocationDeferScope(lifetime);
    const callback = vi.fn(() => new Promise<void>(() => {}));
    scope.registerInline(callback, { scope, phase: "handler", depth: 0 });

    const handle = scope.seal("success");
    const drain = scheduled?.();
    await vi.advanceTimersByTimeAsync(50);

    await expect(drain).resolves.toBeUndefined();
    await expect(handle.settled).resolves.toEqual({
      callbacks: [{ sequence: 0, outcome: "timed-out" }],
      timedOut: true,
      cancelled: false,
    });
    expect(scope.signal.aborted).toBe(true);
    expect(callback).toHaveBeenCalledWith();
  });

  it("settles cancelled without claiming to preempt a running callback", async () => {
    let scheduled: (() => Promise<void>) | undefined;
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
    const scope = createInvocationDeferScope(lifetime);
    scope.registerInline(() => new Promise<void>(() => {}), {
      scope,
      phase: "handler",
      depth: 0,
    });

    const handle = scope.seal("success");
    const drain = scheduled?.();
    scope.cancel("test shutdown");

    await expect(drain).resolves.toBeUndefined();
    await expect(handle.settled).resolves.toEqual({
      callbacks: [{ sequence: 0, outcome: "cancelled" }],
      timedOut: false,
      cancelled: true,
    });
    expect(scope.signal.aborted).toBe(true);
  });

  it("contains callback failure and reports sibling outcomes in registration order", async () => {
    let scheduled: (() => Promise<void>) | undefined;
    const lifetime: DeferLifetimeCapability = {
      completion: "handler-returned",
      limits: {
        maxDrainMs: 1_000,
        maxCallbacks: 10,
        concurrency: 2,
        maxNestingDepth: 2,
      },
      durableFinalization: false,
      schedule(task) {
        scheduled = () => task.run();
      },
    };
    const scope = createInvocationDeferScope(lifetime);
    scope.registerInline(
      async () => {
        await Promise.resolve();
        throw new Error("contained");
      },
      { scope, phase: "handler", depth: 0 },
    );
    scope.registerInline(async () => {}, {
      scope,
      phase: "handler",
      depth: 0,
    });

    const firstHandle = scope.seal("error");
    const secondHandle = scope.seal("success");
    expect(secondHandle).toBe(firstHandle);

    await expect(scheduled?.()).resolves.toBeUndefined();
    await expect(firstHandle.settled).resolves.toEqual({
      callbacks: [
        { sequence: 0, outcome: "failed" },
        { sequence: 1, outcome: "completed" },
      ],
      timedOut: false,
      cancelled: false,
    });
  });

  it("preserves source registration order for arbitrary callback counts", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 20 }), async (count) => {
        let scheduled: (() => Promise<void>) | undefined;
        const lifetime: DeferLifetimeCapability = {
          completion: "handler-returned",
          limits: {
            maxDrainMs: 1_000,
            maxCallbacks: 20,
            concurrency: 3,
            maxNestingDepth: 2,
          },
          durableFinalization: false,
          schedule(task) {
            scheduled = () => task.run();
          },
        };
        const scope = createInvocationDeferScope(lifetime);
        const starts: number[] = [];
        for (let sequence = 0; sequence < count; sequence += 1) {
          scope.registerInline(
            () => {
              starts.push(sequence);
            },
            { scope, phase: "handler", depth: 0 },
          );
        }

        scope.seal("success");
        await scheduled?.();
        expect(starts).toEqual(
          Array.from({ length: count }, (_, sequence) => sequence),
        );
      }),
      { numRuns: 40, seed: 0xdefe12 },
    );
  });
});
