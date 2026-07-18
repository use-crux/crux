import { describe, expect, it, vi } from "vitest";
import { defer } from "@use-crux/core";
import { runWithDeferInvocation } from "@use-crux/core/internal/scope";
import { testLifetime } from "./test-lifetime";

describe("defer limits and concurrency", () => {
  it("rejects registrations beyond the host callback limit before invocation", async () => {
    const first = vi.fn();
    const second = vi.fn();

    await expect(
      runWithDeferInvocation(
        () => {
          defer(first);
          defer(second);
        },
        {
          lifetime: testLifetime(() => {}, { maxCallbacks: 1 }),
          classifyOutcome: (settlement) =>
            settlement.kind === "thrown" ? "error" : "success",
        },
      ),
    ).rejects.toEqual(
      expect.objectContaining({ code: "DEFER_LIMIT_EXCEEDED" }),
    );
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it("runs siblings concurrently and contains one callback rejection", async () => {
    let scheduled: (() => Promise<void>) | undefined;
    let releaseCallbacks: (() => void) | undefined;
    const callbackGate = new Promise<void>((resolve) => {
      releaseCallbacks = resolve;
    });
    const starts: string[] = [];

    await runWithDeferInvocation(
      () => {
        defer(async () => {
          starts.push("first");
          await callbackGate;
          throw new Error("contained callback failure");
        });
        defer(async () => {
          starts.push("second");
          await callbackGate;
        });
      },
      {
        lifetime: testLifetime(
          (task) => {
            scheduled = task;
          },
          { concurrency: 2 },
        ),
        classifyOutcome: () => "success",
      },
    );

    const drain = scheduled?.();
    await Promise.resolve();
    expect(starts).toEqual(["first", "second"]);

    releaseCallbacks?.();
    await expect(drain).resolves.toBeUndefined();
  });

  it("drains nested registrations in waves and enforces nesting depth", async () => {
    let scheduled: (() => Promise<void>) | undefined;
    let nestingError: unknown;
    const nested = vi.fn();

    await runWithDeferInvocation(
      () => {
        defer(() => {
          try {
            defer(nested);
          } catch (error) {
            nestingError = error;
          }
        });
      },
      {
        lifetime: testLifetime(
          (task) => {
            scheduled = task;
          },
          { maxNestingDepth: 0 },
        ),
        classifyOutcome: () => "success",
      },
    );

    await scheduled?.();
    expect(nestingError).toEqual(
      expect.objectContaining({ code: "DEFER_LIMIT_EXCEEDED" }),
    );
    expect(nested).not.toHaveBeenCalled();
  });
});
