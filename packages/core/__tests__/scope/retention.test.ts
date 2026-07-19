import { describe, expect, it, vi } from "vitest";
import { defer } from "@use-crux/core";
import type {
  CruxHostBinding,
  ScopeRetainedTask,
} from "@use-crux/core/internal/scope";
import {
  bindRootRetention,
  enqueueRetainedTask,
  openScope,
  resolveConfiguredHost,
} from "../../src/scope/internal";
import { getHooks, setHooks } from "../../src/runtime/runtime";

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: () => resolvePromise?.() };
}

function retainedRoot(): {
  readonly scope: ReturnType<typeof openScope>["scope"];
  readonly retain: ReturnType<
    typeof vi.fn<(work: () => Promise<void>) => void>
  >;
  readonly retainedWork: () => Promise<void>;
} {
  let work: (() => Promise<void>) | undefined;
  const retain = vi.fn<(nextWork: () => Promise<void>) => void>((nextWork) => {
    work = nextWork;
  });
  const binding: CruxHostBinding = {
    kind: "test",
    invocationScope: true,
    retain,
  };
  const controller = openScope({ kind: "invocation" }, {});
  bindRootRetention(controller.scope, binding);
  return {
    scope: controller.scope,
    retain,
    retainedWork: () => {
      if (!work) throw new TypeError("No retained work was registered.");
      return work();
    },
  };
}

describe("execution scope retention gate", () => {
  it("resolves the binding installed by config hooks", () => {
    const previous = getHooks();
    const binding: CruxHostBinding = {
      kind: "test",
      invocationScope: true,
      retain: () => {},
    };
    try {
      setHooks({ ...previous, hostBinding: binding });
      expect(resolveConfiguredHost()).toBe(binding);
    } finally {
      setHooks(previous);
    }
  });

  it("fires once whichever gate input signals first", () => {
    const taskFirst = retainedRoot();
    enqueueRetainedTask(
      taskFirst.scope,
      task(() => Promise.resolve()),
    );
    taskFirst.scope.trackPending(Promise.resolve());
    expect(taskFirst.retain).toHaveBeenCalledOnce();

    const pendingFirst = retainedRoot();
    pendingFirst.scope.trackPending(Promise.resolve());
    enqueueRetainedTask(
      pendingFirst.scope,
      task(() => Promise.resolve()),
    );
    expect(pendingFirst.retain).toHaveBeenCalledOnce();
  });

  it("starts queued tasks only inside the retained callback", async () => {
    const root = retainedRoot();
    const run = vi.fn(() => Promise.resolve());
    enqueueRetainedTask(root.scope, task(run));

    expect(run).not.toHaveBeenCalled();
    await root.retainedWork();
    expect(run).toHaveBeenCalledOnce();
  });

  it("starts late-enqueued tasks immediately", async () => {
    const root = retainedRoot();
    const active = deferred();
    root.scope.trackPending(active.promise);
    const retained = root.retainedWork();
    const run = vi.fn(() => Promise.resolve());

    enqueueRetainedTask(root.scope, task(run));

    expect(run).toHaveBeenCalledOnce();
    active.resolve();
    await retained;
  });

  it("lets immediate inner drains extend retained idle", async () => {
    const root = retainedRoot();
    const innerDrain = deferred();
    let retainedSettled = false;
    root.scope.trackPending(innerDrain.promise);

    const retained = root.retainedWork().then(() => {
      retainedSettled = true;
    });
    await Promise.resolve();
    expect(retainedSettled).toBe(false);

    innerDrain.resolve();
    await retained;
    expect(retainedSettled).toBe(true);
  });

  it("reduces ambient inline defer to one retained callback", async () => {
    const previous = getHooks();
    let retainedWork: (() => Promise<void>) | undefined;
    const callback = vi.fn();
    const retain = vi.fn((work: () => Promise<void>) => {
      retainedWork = work;
    });
    try {
      setHooks({
        ...previous,
        hostBinding: { kind: "next", invocationScope: true, retain },
      });

      defer(callback);

      expect(retain).toHaveBeenCalledOnce();
      expect(callback).not.toHaveBeenCalled();
      await retainedWork?.();
      expect(callback).toHaveBeenCalledOnce();
    } finally {
      setHooks(previous);
    }
  });
});

function task(run: () => Promise<void>): ScopeRetainedTask {
  return { run, cancel: () => {} };
}
