import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CruxEffectError,
  RollbackError,
  effect,
  rollbackOnError,
} from "../src/effect/index";
import { resetEffectDefinitionsForTesting } from "../src/effect/define-effect";

describe("effect boundary controller", () => {
  beforeEach(() => {
    resetEffectDefinitionsForTesting();
  });

  it("rolls back completed units and lets the callback return a rejection value", async () => {
    const events: string[] = [];
    const update = effect(
      "customer.manual-rejection",
      async () => {
        events.push("execute");
      },
      {
        recover: async () => {
          events.push("recover");
        },
      },
    );

    const value = await rollbackOnError(async (scope) => {
      await update();
      const result = await scope.rollback({
        reason: "review rejected",
      });
      expect(result.status).toBe("completed");
      expect(result.scope).toEqual(scope.ref);
      return { status: "rejected" as const };
    });

    expect(value).toEqual({ status: "rejected" });
    expect(events).toEqual(["execute", "recover"]);
  });

  it("rejects effect preparation while rollback is in progress", async () => {
    let releaseRecovery: (() => void) | undefined;
    const recoveryReleased = new Promise<void>((resolve) => {
      releaseRecovery = resolve;
    });
    let noteRecoveryStarted: (() => void) | undefined;
    const recoveryStarted = new Promise<void>((resolve) => {
      noteRecoveryStarted = resolve;
    });
    const update = effect(
      "customer.terminal-update",
      async () => undefined,
      {
        recover: async () => {
          noteRecoveryStarted?.();
          await recoveryReleased;
        },
      },
    );
    const resource = vi.fn(() => ({
      type: "customer",
      id: "late",
    }));
    const capture = vi.fn(async () => "before");
    const lateExecutor = vi.fn(async () => "late");
    const late = effect(
      "customer.terminal-late",
      lateExecutor,
      {
        resource,
        recover: {
          capture,
          execute: async () => undefined,
        },
      },
    );

    const value = await rollbackOnError(async (scope) => {
      await update();
      const rollback = scope.rollback();
      await recoveryStarted;
      const pureValue = "computed";
      try {
        await expect(late()).rejects.toEqual(
          expect.objectContaining<Partial<CruxEffectError>>({
            code: "EFFECT_SCOPE_TERMINAL",
          }),
        );
      } finally {
        releaseRecovery?.();
      }
      await expect(rollback).resolves.toMatchObject({
        status: "completed",
      });
      return pureValue;
    });

    expect(value).toBe("computed");
    expect(resource).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    expect(lateExecutor).not.toHaveBeenCalled();
  });

  it("waits for already-started effects before manual rollback planning", async () => {
    let releaseEffect: (() => void) | undefined;
    const effectReleased = new Promise<void>((resolve) => {
      releaseEffect = resolve;
    });
    let noteEffectStarted: (() => void) | undefined;
    const effectStarted = new Promise<void>((resolve) => {
      noteEffectStarted = resolve;
    });
    const recovery = vi.fn(async () => undefined);
    const update = effect(
      "customer.manual-concurrent",
      async () => {
        noteEffectStarted?.();
        await effectReleased;
      },
      { recover: recovery },
    );
    let rollbackSettled = false;

    const status = await rollbackOnError(async (scope) => {
      const operation = update();
      await effectStarted;
      const rollback = scope.rollback();
      void rollback.finally(() => {
        rollbackSettled = true;
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(rollbackSettled).toBe(false);
      expect(recovery).not.toHaveBeenCalled();
      releaseEffect?.();
      await operation;
      return (await rollback).status;
    });

    expect(status).toBe("completed");
    expect(recovery).toHaveBeenCalledOnce();
  });

  it("rejects an incomplete required manual rollback without a callback cause", async () => {
    const recoveryFailure = new Error("manual recovery failed");
    const update = effect(
      "customer.required-incomplete",
      async () => undefined,
      {
        recover: async () => {
          throw recoveryFailure;
        },
      },
    );
    let thrown: unknown;

    try {
      await rollbackOnError(async (scope) => {
        await update();
        const result = await scope.rollback();
        expect(result.status).toBe("failed");
        return "rejected";
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RollbackError);
    expect(thrown).toMatchObject({
      recoveryError: recoveryFailure,
      result: {
        status: "failed",
      },
    });
    expect((thrown as RollbackError).cause).toBeUndefined();
  });

  it("lets best-effort callbacks return after an incomplete manual result", async () => {
    const update = effect(
      "customer.best-effort-incomplete",
      async () => undefined,
      {
        recover: async () => {
          throw new Error("best-effort recovery failed");
        },
      },
    );

    const value = await rollbackOnError(
      async (scope) => {
        await update();
        const result = await scope.rollback();
        expect(result.status).toBe("failed");
        return "rejected";
      },
      { recovery: "best-effort" },
    );

    expect(value).toBe("rejected");
  });

  it("rethrows the original callback error after completed manual rollback", async () => {
    const update = effect(
      "customer.completed-then-throw",
      async () => undefined,
      { recover: async () => undefined },
    );
    const original = new Error("work failed after rollback");

    await expect(
      rollbackOnError(async (scope) => {
        await update();
        await scope.rollback();
        throw original;
      }),
    ).rejects.toBe(original);
  });

  it("attaches the callback error after incomplete manual rollback", async () => {
    const recoveryFailure = new Error("recovery stayed incomplete");
    const update = effect(
      "customer.incomplete-then-throw",
      async () => undefined,
      {
        recover: async () => {
          throw recoveryFailure;
        },
      },
    );
    const original = new Error("work failed after partial rollback");
    let thrown: unknown;

    try {
      await rollbackOnError(async (scope) => {
        await update();
        const result = await scope.rollback();
        expect(result.status).toBe("failed");
        throw original;
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RollbackError);
    expect(thrown).toMatchObject({
      cause: original,
      recoveryError: recoveryFailure,
      result: {
        status: "failed",
      },
    });
  });

  it("surfaces a caught pre-result manual recovery failure", async () => {
    const recoveryFailure = new Error("rollback could not start");
    const update = effect(
      "customer.manual-pre-result-failure",
      async () => undefined,
      { recover: async () => undefined },
    );
    const now = vi.spyOn(Date, "now");
    let caught: unknown;
    let thrown: unknown;

    try {
      await rollbackOnError(async (scope) => {
        await update();
        now.mockImplementationOnce(() => {
          throw recoveryFailure;
        });
        try {
          await scope.rollback();
        } catch (error) {
          caught = error;
        }
        return "ignored";
      });
    } catch (error) {
      thrown = error;
    } finally {
      now.mockRestore();
    }

    expect(caught).toBe(recoveryFailure);
    expect(thrown).toBeInstanceOf(RollbackError);
    expect(thrown).toMatchObject({
      recoveryError: recoveryFailure,
    });
    expect((thrown as RollbackError).cause).toBeUndefined();
  });

});
