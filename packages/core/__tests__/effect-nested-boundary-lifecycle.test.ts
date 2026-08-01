import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CruxEffectError,
  effect,
  rollback,
  rollbackOnError,
} from "../src/effect/index";
import { resetEffectDefinitionsForTesting } from "../src/effect/define-effect";

describe("nested effect boundary lifecycle", () => {
  beforeEach(() => {
    resetEffectDefinitionsForTesting();
  });

  it("waits for a child and closes descendant admission before parent rollback", async () => {
    const events: string[] = [];
    let releaseChild: (() => void) | undefined;
    const childReleased = new Promise<void>((resolve) => {
      releaseChild = resolve;
    });
    let noteChildStarted: (() => void) | undefined;
    const childStarted = new Promise<void>((resolve) => {
      noteChildStarted = resolve;
    });
    const first = effect(
      "ordering.concurrent-child-first",
      async () => {
        events.push("execute:first");
      },
      {
        recover: async () => {
          events.push("recover:first");
        },
      },
    );
    const lateExecutor = vi.fn(async () => undefined);
    const late = effect(
      "ordering.concurrent-child-late",
      lateExecutor,
      { recover: async () => undefined },
    );
    let child: Promise<unknown> | undefined;

    const result = await rollbackOnError(async (scope) => {
      child = rollbackOnError(async () => {
        await first();
        noteChildStarted?.();
        await childReleased;
        await late();
      });
      void child.catch(() => undefined);
      await childStarted;
      const rollbackOperation = scope.rollback();
      releaseChild?.();
      return rollbackOperation;
    });

    await expect(child).rejects.toEqual(
      expect.objectContaining<Partial<CruxEffectError>>({
        code: "EFFECT_SCOPE_TERMINAL",
      }),
    );
    expect(lateExecutor).not.toHaveBeenCalled();
    expect(events).toEqual(["execute:first", "recover:first"]);
    expect(result.units).toMatchObject([
      {
        effectIds: ["ordering.concurrent-child-first"],
        status: "already_recovered",
      },
    ]);
  });

  it("settles the parent unit when a child scope is rolled back directly", async () => {
    const events: string[] = [];
    const outer = effect(
      "ordering.direct-child-outer",
      async () => undefined,
      {
        recover: async () => {
          events.push("recover:outer");
        },
      },
    );
    const child = effect(
      "ordering.direct-child-inner",
      async () => undefined,
      {
        recover: async () => {
          events.push("recover:child");
        },
      },
    );

    const result = await rollbackOnError(async (scope) => {
      await outer();
      let childRef: typeof scope.ref | undefined;
      await rollbackOnError(async (childScope) => {
        childRef = childScope.ref;
        await child();
      });
      if (!childRef) throw new TypeError("Child boundary did not run.");
      await rollback(childRef);
      return scope.rollback();
    });

    expect(events).toEqual(["recover:child", "recover:outer"]);
    expect(result.units).toMatchObject([
      {
        effectIds: ["ordering.direct-child-inner"],
        status: "already_recovered",
      },
      {
        effectIds: ["ordering.direct-child-outer"],
        status: "recovered",
      },
    ]);
  });

  it("preserves cancellation from a recursively rolled back child", async () => {
    const controller = new AbortController();
    const first = effect(
      "ordering.cancelled-child-first",
      async () => undefined,
      { recover: async () => undefined },
    );
    const second = effect(
      "ordering.cancelled-child-second",
      async () => undefined,
      {
        recover: async () => {
          controller.abort();
        },
      },
    );

    const result = await rollbackOnError(
      async (scope) => {
        await rollbackOnError(async () => {
          await first();
          await second();
        });
        return scope.rollback({ signal: controller.signal });
      },
      { recovery: "best-effort" },
    );

    expect(result.status).toBe("cancelled");
    expect(result.units).toMatchObject([
      {
        effectIds: [
          "ordering.cancelled-child-first",
          "ordering.cancelled-child-second",
        ],
        status: "cancelled",
      },
    ]);
  });

  it("preserves a blocked child settlement without calling it failed", async () => {
    const irreversible = effect(
      "ordering.blocked-child",
      async () => undefined,
    );

    const result = await rollbackOnError(
      async (scope) => {
        await rollbackOnError(
          async () => irreversible(),
          { recovery: "best-effort" },
        );
        return scope.rollback();
      },
      { recovery: "best-effort" },
    );

    expect(result.status).toBe("not_possible");
    expect(result.units).toMatchObject([
      {
        effectIds: ["ordering.blocked-child"],
        status: "irreversible",
      },
    ]);
  });

  it("waits for an unawaited child before normally closing its parent", async () => {
    let releaseChild: (() => void) | undefined;
    const childReleased = new Promise<void>((resolve) => {
      releaseChild = resolve;
    });
    let noteChildStarted: (() => void) | undefined;
    const childStarted = new Promise<void>((resolve) => {
      noteChildStarted = resolve;
    });
    const executor = vi.fn(async () => undefined);
    const update = effect(
      "ordering.normal-close-child",
      executor,
      { recover: async () => undefined },
    );
    let child: Promise<unknown> | undefined;
    let settlement: unknown;

    const parent = rollbackOnError(async () => {
      child = rollbackOnError(async () => {
        noteChildStarted?.();
        await childReleased;
        await update();
      });
      void child.catch(() => undefined);
      await childStarted;
      return "done";
    });
    void parent.then((value) => {
      settlement = value;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(settlement).toBeUndefined();
    releaseChild?.();
    await expect(parent).resolves.toBe("done");
    await expect(child).resolves.toBeUndefined();
    expect(executor).toHaveBeenCalledOnce();
  });

  it("preserves a failed child aggregate when a blocked unit appears first", async () => {
    const recoveryFailure = new Error("recovery failed");
    const failing = effect(
      "ordering.mixed-child-failing",
      async () => undefined,
      {
        recover: async () => {
          throw recoveryFailure;
        },
      },
    );
    const irreversible = effect(
      "ordering.mixed-child-irreversible",
      async () => undefined,
    );

    const result = await rollbackOnError(
      async (scope) => {
        await rollbackOnError(
          async () => {
            await failing();
            await irreversible();
          },
          { recovery: "best-effort" },
        );
        return scope.rollback();
      },
      { recovery: "best-effort" },
    );

    expect(result.status).toBe("failed");
    expect(result.units).toMatchObject([
      {
        effectIds: [
          "ordering.mixed-child-failing",
          "ordering.mixed-child-irreversible",
        ],
        status: "failed",
      },
    ]);
  });

  it("rejects ancestor rollback requested from a live child boundary", async () => {
    await rollbackOnError(async (outerScope) => {
      await expect(
        rollbackOnError(async () => outerScope.rollback()),
      ).rejects.toEqual(
        expect.objectContaining<Partial<CruxEffectError>>({
          code: "EFFECT_SCOPE_TERMINAL",
        }),
      );
    });
  });
});
