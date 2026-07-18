import { describe, expect, it, vi } from "vitest";
import {
  createHandlerReturnedDeferLifetime,
  createResponseFinishedDeferLifetime,
} from "@use-crux/core/internal/scope";
import type {
  DeferScheduledTask,
  DeferLifetimeCapability,
} from "@use-crux/core/internal/scope";

const limits = {
  maxDrainMs: 1_000,
  maxCallbacks: 10,
  concurrency: 2,
  maxNestingDepth: 3,
} as const;

function scheduledTask(): DeferScheduledTask & {
  readonly run: ReturnType<typeof vi.fn<DeferScheduledTask["run"]>>;
  readonly cancel: ReturnType<typeof vi.fn<DeferScheduledTask["cancel"]>>;
} {
  return {
    run: vi.fn(async () => {}),
    cancel: vi.fn(),
  };
}

describe("generic defer lifetimes", () => {
  it("runs and synchronously hands off handler-returned work", () => {
    const handoff = vi.fn<(promise: Promise<void>) => void>();
    const lifetime = createHandlerReturnedDeferLifetime({
      limits,
      durableFinalization: true,
      handoff,
    });
    const task = scheduledTask();

    lifetime.schedule(task);

    expect(lifetime).toMatchObject({
      completion: "handler-returned",
      limits,
      supportsInline: true,
      durableFinalization: true,
    } satisfies Partial<DeferLifetimeCapability>);
    expect(task.run).toHaveBeenCalledOnce();
    expect(handoff).toHaveBeenCalledOnce();
    expect(handoff.mock.calls[0]?.[0]).toBeInstanceOf(Promise);
  });

  it("starts response-finished work exactly once after an early boundary", () => {
    let finish: (() => void) | undefined;
    const start = vi.fn<(task: DeferScheduledTask) => void>();
    const unsubscribe = vi.fn();
    const lifetime = createResponseFinishedDeferLifetime({
      limits,
      durableFinalization: false,
      subscribe(terminal) {
        finish = terminal.finish;
        terminal.finish();
        return unsubscribe;
      },
      start,
    });
    const task = scheduledTask();

    lifetime.schedule(task);
    finish?.();

    expect(lifetime).toMatchObject({
      completion: "response-finished",
      supportsInline: true,
      durableFinalization: false,
    });
    expect(start).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledWith(task);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("cancels an unscheduled response task with the exact terminal reason", () => {
    let cancel: ((reason?: unknown) => void) | undefined;
    const start = vi.fn<(task: DeferScheduledTask) => void>();
    const lifetime = createResponseFinishedDeferLifetime({
      limits,
      durableFinalization: false,
      subscribe(terminal) {
        cancel = terminal.cancel;
        return () => {};
      },
      start,
    });
    const task = scheduledTask();
    const reason = new Error("forced shutdown");

    cancel?.(reason);
    lifetime.schedule(task);

    expect(start).not.toHaveBeenCalled();
    expect(task.cancel).toHaveBeenCalledOnce();
    expect(task.cancel).toHaveBeenCalledWith(reason);
  });

  it("waits for a response terminal when work is scheduled first", () => {
    let finish: (() => void) | undefined;
    const start = vi.fn<(task: DeferScheduledTask) => void>();
    const unsubscribe = vi.fn();
    const lifetime = createResponseFinishedDeferLifetime({
      limits,
      durableFinalization: false,
      subscribe(terminal) {
        finish = terminal.finish;
        return unsubscribe;
      },
      start,
    });
    const task = scheduledTask();

    lifetime.schedule(task);
    expect(start).not.toHaveBeenCalled();

    finish?.();
    finish?.();
    expect(start).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("cooperatively cancels work scheduled before its terminal", () => {
    let cancel: ((reason?: unknown) => void) | undefined;
    const lifetime = createResponseFinishedDeferLifetime({
      limits,
      durableFinalization: false,
      subscribe(terminal) {
        cancel = terminal.cancel;
        return () => {};
      },
      start: vi.fn(),
    });
    const task = scheduledTask();
    const reason = new Error("host lifetime lost");

    lifetime.schedule(task);
    cancel?.(reason);

    expect(task.cancel).toHaveBeenCalledOnce();
    expect(task.cancel).toHaveBeenCalledWith(reason);
    expect(task.run).not.toHaveBeenCalled();
  });
});
