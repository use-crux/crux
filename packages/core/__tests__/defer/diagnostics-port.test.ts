import { describe, expect, it, vi } from "vitest";
import {
  runWithDeferRegistration,
  type DeferRegistrationScope,
} from "../../src/defer/internal/context";
import { scheduleDiagnosticsOnlyDeferredCallback } from "../../src/defer/internal/port";
import { createTestScopeDeferController, testBinding } from "./test-binding";

describe("diagnostics-only defer port", () => {
  it("runs work inline without a retained scope", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const callback = vi.fn(async () => gate);

    const handle = scheduleDiagnosticsOnlyDeferredCallback(callback);

    expect(handle.status).toBe("inline");
    expect(Object.isFrozen(handle)).toBe(true);
    await vi.waitFor(() => expect(callback).toHaveBeenCalledOnce());

    let settled = false;
    void handle.settled.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    release();
    await expect(handle.settled).resolves.toBeUndefined();
  });

  it("tracks work accepted by a retained parent drain", async () => {
    let runRetained: (() => Promise<void>) | undefined;
    const binding = testBinding((run) => {
      runRetained = run;
    });
    const callback = vi.fn();
    const parent = createTestScopeDeferController(binding);
    const scheduled = runWithDeferRegistration(handlerRegistration(parent), () =>
      scheduleDiagnosticsOnlyDeferredCallback(callback),
    );

    expect(scheduled.status).toBe("deferred");

    const handle = parent.seal("success");
    await runRetained?.();

    expect(callback).toHaveBeenCalledOnce();
    await expect(scheduled.settled).resolves.toBeUndefined();
    await expect(handle.settled).resolves.toMatchObject({
      callbacks: [{ sequence: 0, outcome: "completed" }],
    });
  });

  it("falls back inline when retained callback capacity is exhausted", async () => {
    const retainedTasks: Array<() => Promise<void>> = [];
    const binding = testBinding(
      (run) => retainedTasks.push(run),
      { maxCallbacks: 0 },
    );
    const callback = vi.fn();
    const parent = createTestScopeDeferController(binding);

    const scheduled = runWithDeferRegistration(handlerRegistration(parent), () =>
      scheduleDiagnosticsOnlyDeferredCallback(callback),
    );

    expect(scheduled.status).toBe("inline");
    await expect(scheduled.settled).resolves.toBeUndefined();
    expect(callback).toHaveBeenCalledOnce();
    expect(retainedTasks).toEqual([]);
  });

  it("propagates unknown registration errors", () => {
    const registrationError = new Error("unexpected registration failure");
    const callback = vi.fn();
    const scope: DeferRegistrationScope = {
      callbackRetention: "retained",
      registerInline() {
        throw registrationError;
      },
      trackCommit() {},
      stageNamed() {
        throw registrationError;
      },
    };

    expect(() =>
      runWithDeferRegistration(
        { scope, phase: "handler", depth: 0 },
        () => scheduleDiagnosticsOnlyDeferredCallback(callback),
      ),
    ).toThrow(registrationError);
    expect(callback).not.toHaveBeenCalled();
  });
});

function handlerRegistration(
  scope: ReturnType<typeof createTestScopeDeferController>,
) {
  return { scope, phase: "handler" as const, depth: 0 };
}
