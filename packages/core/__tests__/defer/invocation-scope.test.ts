import { afterEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { createTestScopeDeferController, testBinding } from "./test-binding";

describe("invocation defer scope", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("settles at the drain deadline and aborts its cooperative signal", async () => {
    vi.useFakeTimers();
    let scheduled: (() => Promise<void>) | undefined;
    const binding = testBinding(
      (run) => {
        scheduled = run;
      },
      { maxDrainMs: 50, maxNestingDepth: 2 },
    );
    const scope = createTestScopeDeferController(binding);
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
    const binding = testBinding((run) => {
      scheduled = run;
    });
    const scope = createTestScopeDeferController(binding);
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
    const binding = testBinding(
      (run) => {
        scheduled = run;
      },
      { concurrency: 2 },
    );
    const scope = createTestScopeDeferController(binding);
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

    const firstHandle = scope.seal("success");
    const secondHandle = scope.seal("error");
    expect(secondHandle).toBe(firstHandle);

    await expect(scheduled?.()).resolves.toBeUndefined();
    await expect(firstHandle.settled).resolves.toMatchObject({
      callbacks: [
        {
          sequence: 0,
          outcome: "failed",
          error: {
            code: "DEFER_CALLBACK_FAILED",
            cause: expect.objectContaining({ message: "contained" }),
          },
        },
        { sequence: 1, outcome: "completed" },
      ],
      timedOut: false,
      cancelled: false,
    });
  });

  it("runs and awaits the drain-settled lane after callbacks", async () => {
    let scheduled: (() => Promise<void>) | undefined;
    let releaseLane: (() => void) | undefined;
    let markLaneStarted: (() => void) | undefined;
    const laneGate = new Promise<void>((resolve) => {
      releaseLane = resolve;
    });
    const laneStarted = new Promise<void>((resolve) => {
      markLaneStarted = resolve;
    });
    const events: string[] = [];
    const binding = testBinding((run) => {
      scheduled = run;
    });
    const scope = createTestScopeDeferController(binding);
    scope.registerInline(
      () => {
        events.push("callback");
      },
      { scope, phase: "handler", depth: 0 },
    );
    scope.onDrainSettled(async (result) => {
      events.push(`lane:${result.callbacks[0]?.outcome}`);
      markLaneStarted?.();
      await laneGate;
    });

    scope.seal("success");
    const drain = scheduled?.().then(() => events.push("retained-complete"));
    await laneStarted;

    expect(events).toEqual(["callback", "lane:completed"]);
    releaseLane?.();
    await drain;
    expect(events).toEqual(["callback", "lane:completed", "retained-complete"]);
  });

  it("preserves source registration order for arbitrary callback counts", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 20 }), async (count) => {
        let scheduled: (() => Promise<void>) | undefined;
        const binding = testBinding(
          (run) => {
            scheduled = run;
          },
          { maxCallbacks: 20, concurrency: 3 },
        );
        const scope = createTestScopeDeferController(binding);
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
