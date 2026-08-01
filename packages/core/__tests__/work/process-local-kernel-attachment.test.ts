import { describe, expect, it } from "vitest";
import type { InternalWorkExecutionContext } from "../../src/work/internal/target-driver";
import { createProcessLocalWorkKernel } from "../../src/work/internal/process-local-kernel";

describe("process-local attached Work", () => {
  it("attached child inherits parent identity without a parent handle", async () => {
    const ids = ["work_parent", "work_child"];
    const kernel = createProcessLocalWorkKernel({
      createId: () => ids.shift() ?? "unexpected_work",
      schedule: (start) => start(),
    });
    let parentContext: InternalWorkExecutionContext | undefined;
    let childContext: InternalWorkExecutionContext | undefined;

    const parent = await kernel.spawn({
      async run(context) {
        parentContext = context;
        const child = await kernel.spawn({
          async run(nestedContext) {
            childContext = nestedContext;
            return "child result" as const;
          },
        });
        return child.result();
      },
    });

    await expect(parent.result()).resolves.toBe("child result");
    expect(parentContext).not.toHaveProperty("attachedParentId");
    expect(childContext).toMatchObject({
      id: "work_child",
      attachedParentId: "work_parent",
    });
    expect(childContext).not.toHaveProperty("parent");
    expect(childContext).not.toHaveProperty("result");
    expect(childContext).not.toHaveProperty("cancel");
  });

  it("attached child observes an already-aborted parent signal before target work begins", async () => {
    const cancellation = Object.freeze({ kind: "parent-pre-abort" });
    const parent = new AbortController();
    parent.abort(cancellation);
    let observedBeforeTargetWork = false;
    const kernel = createProcessLocalWorkKernel({
      createId: () => "work_pre_aborted_child",
      schedule: (start) => start(),
    });

    const child = await kernel.spawn(
      {
        async run(context) {
          observedBeforeTargetWork = context.signal.aborted;
          context.signal.throwIfAborted();
          return "unreachable";
        },
      },
      { parentId: "work_pre_aborted_parent", signal: parent.signal },
    );

    await expect(child.result()).rejects.toBe(cancellation);
    expect(observedBeforeTargetWork).toBe(true);
  });

  it("aborting an attached parent while child work is in flight aborts the child signal and rejects the child result", async () => {
    const cancellation = Object.freeze({ kind: "parent-in-flight-abort" });
    const parent = new AbortController();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const kernel = createProcessLocalWorkKernel({
      createId: () => "work_in_flight_child",
      schedule: (start) => start(),
    });

    const child = await kernel.spawn(
      {
        async run(context) {
          markStarted();
          return new Promise<never>((_resolve, reject) => {
            context.signal.addEventListener(
              "abort",
              () => reject(context.signal.reason),
              { once: true },
            );
          });
        },
      },
      { parentId: "work_in_flight_parent", signal: parent.signal },
    );

    await started;
    parent.abort(cancellation);

    await expect(child.result()).rejects.toBe(cancellation);
  });

  it("nested attached spawn inherits root identity and cancellation without handles", async () => {
    const ids = ["work_parent", "work_child", "work_grandchild"];
    const cancellation = Object.freeze({ kind: "root-recursive-abort" });
    const root = new AbortController();
    const contexts: InternalWorkExecutionContext[] = [];
    let markGrandchildStarted!: () => void;
    const grandchildStarted = new Promise<void>((resolve) => {
      markGrandchildStarted = resolve;
    });
    const kernel = createProcessLocalWorkKernel({
      createId: () => ids.shift() ?? "unexpected_work",
      schedule: (start) => start(),
    });

    const parent = await kernel.spawn(
      {
        async run(parentContext) {
          contexts.push(parentContext);
          await Promise.resolve();
          const child = await kernel.spawn({
            async run(childContext) {
              contexts.push(childContext);
              await Promise.resolve();
              const grandchild = await kernel.spawn({
                async run(grandchildContext) {
                  contexts.push(grandchildContext);
                  markGrandchildStarted();
                  return new Promise<never>((_resolve, reject) => {
                    grandchildContext.signal.addEventListener(
                      "abort",
                      () => reject(grandchildContext.signal.reason),
                      { once: true },
                    );
                  });
                },
              });
              return grandchild.result();
            },
          });
          return child.result();
        },
      },
      { parentId: "work_root", signal: root.signal },
    );

    await grandchildStarted;
    root.abort(cancellation);

    await expect(parent.result()).rejects.toBe(cancellation);
    expect(
      contexts.map(({ id, attachedParentId }) => ({ id, attachedParentId })),
    ).toEqual([
      { id: "work_parent", attachedParentId: "work_root" },
      { id: "work_child", attachedParentId: "work_parent" },
      { id: "work_grandchild", attachedParentId: "work_child" },
    ]);
    expect(contexts.every((context) => context.signal.aborted)).toBe(true);
    for (const context of contexts) {
      expect(context).not.toHaveProperty("parent");
      expect(context).not.toHaveProperty("result");
      expect(context).not.toHaveProperty("cancel");
    }
  });

  it("attached cancellation records one terminal result occurrence", async () => {
    const cancellation = Object.freeze({ kind: "terminal-race-abort" });
    const parent = new AbortController();
    let driverRuns = 0;
    let terminalAttempts = 0;
    let clockReads = 0;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let completeTarget!: () => void;
    const kernel = createProcessLocalWorkKernel({
      createId: () => "work_terminal_race",
      now: () => new Date(++clockReads),
      schedule: (start) => start(),
    });

    const child = await kernel.spawn(
      {
        async run(context) {
          driverRuns += 1;
          markStarted();
          return new Promise<"completed">((resolve, reject) => {
            completeTarget = () => {
              terminalAttempts += 1;
              resolve("completed");
            };
            context.signal.addEventListener(
              "abort",
              () => {
                terminalAttempts += 1;
                reject(context.signal.reason);
              },
              { once: true },
            );
          });
        },
      },
      { parentId: "work_terminal_parent", signal: parent.signal },
    );
    const firstResult = child.result();
    const secondResult = child.result();

    await started;
    parent.abort(cancellation);
    completeTarget();

    expect(firstResult).toBe(secondResult);
    await expect(firstResult).rejects.toBe(cancellation);
    await expect(secondResult).rejects.toBe(cancellation);
    await expect(child.status()).resolves.toMatchObject({
      id: "work_terminal_race",
      state: "failed",
    });
    expect(driverRuns).toBe(1);
    expect(terminalAttempts).toBe(2);
    expect(clockReads).toBe(3);
  });
});
