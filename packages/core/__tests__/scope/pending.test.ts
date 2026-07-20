import { describe, expect, it, vi } from "vitest";
import { openScope, whenRootIdle } from "../../src/scope/internal";

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve: () => resolve?.() };
}

describe("execution scope pending work", () => {
  it("waits for operations added while an earlier close hook is draining", async () => {
    const controller = openScope({ kind: "invocation" }, {});
    const first = deferred();
    const second = deferred();
    let idle = false;

    first.promise.then(() => controller.scope.trackPending(second.promise));
    controller.scope.onClose(() => first.promise);
    controller.seal("success");
    const waiting = whenRootIdle(controller.scope).then(() => {
      idle = true;
    });

    first.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(idle).toBe(false);

    second.resolve();
    await waiting;
    expect(idle).toBe(true);
  });

  it("rechecks an initially empty set after a microtask", async () => {
    const controller = openScope({ kind: "invocation" }, {});
    const operation = deferred();
    let idle = false;

    const waiting = whenRootIdle(controller.scope).then(() => {
      idle = true;
    });
    controller.scope.trackPending(operation.promise);

    await Promise.resolve();
    expect(idle).toBe(false);

    operation.resolve();
    await waiting;
    expect(idle).toBe(true);
  });

  it("resolves every waiter once the shared root becomes idle", async () => {
    const controller = openScope({ kind: "invocation" }, {});
    const operation = deferred();
    const first = vi.fn();
    const second = vi.fn();
    controller.scope.trackPending(operation.promise);

    const waiters = [
      whenRootIdle(controller.scope).then(first),
      whenRootIdle(controller.scope).then(second),
    ];
    operation.resolve();
    await Promise.all(waiters);

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it("accepts pending work added after root sealing", async () => {
    const controller = openScope({ kind: "invocation" }, {});
    const operation = deferred();
    let idle = false;
    controller.seal("success");

    controller.scope.trackPending(operation.promise);
    const waiting = whenRootIdle(controller.scope).then(() => {
      idle = true;
    });
    await Promise.resolve();
    expect(idle).toBe(false);

    operation.resolve();
    await waiting;
    expect(idle).toBe(true);
  });
});
