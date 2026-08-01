import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CruxEffectError,
  RollbackError,
  effect,
  rollbackOnError,
} from "../src/effect/index";
import { resetEffectDefinitionsForTesting } from "../src/effect/define-effect";

describe("rollbackOnError", () => {
  beforeEach(() => {
    resetEffectDefinitionsForTesting();
  });

  it("recovers completed effects in LIFO order and rethrows the original error", async () => {
    const events: string[] = [];
    const first = effect(
      "customer.rollback-first",
      async () => {
        events.push("execute:first");
      },
      {
        recover: async () => {
          events.push("recover:first");
        },
      },
    );
    const second = effect(
      "customer.rollback-second",
      async () => {
        events.push("execute:second");
      },
      {
        recover: async () => {
          events.push("recover:second");
        },
      },
    );
    const original = new Error("callback failed");

    await expect(
      rollbackOnError(async () => {
        await first();
        await second();
        throw original;
      }),
    ).rejects.toBe(original);

    expect(events).toEqual([
      "execute:first",
      "execute:second",
      "recover:second",
      "recover:first",
    ]);
  });

  it("returns normally without recovery when the callback succeeds", async () => {
    const recovery = vi.fn(async () => undefined);
    const update = effect(
      "customer.rollback-success",
      async () => "updated",
      { recover: recovery },
    );

    await expect(
      rollbackOnError(async () => update()),
    ).resolves.toBe("updated");
    expect(recovery).not.toHaveBeenCalled();
  });

  it("blocks an irreversible effect before execution in required mode", async () => {
    const executor = vi.fn(async () => "sent");
    const send = effect("email.rollback-required", executor);

    await expect(
      rollbackOnError(async () => send()),
    ).rejects.toEqual(
      expect.objectContaining<Partial<CruxEffectError>>({
        code: "EFFECT_RECOVERY_REQUIRED",
        message: expect.stringMatching(
          /email\.rollback-required[\s\S]*effect-boundary:[^\s]+[\s\S]*Define recovery[\s\S]*move the effect out[\s\S]*best-effort/,
        ),
      }),
    );
    expect(executor).not.toHaveBeenCalled();
  });

  it("reports a partial best-effort rollback with the callback error as cause", async () => {
    const recovery = vi.fn(async () => undefined);
    const update = effect(
      "customer.rollback-best-effort",
      async () => "updated",
      { recover: recovery },
    );
    const send = effect(
      "email.rollback-best-effort",
      async () => "sent",
    );
    const original = new Error("later work failed");
    let thrown: unknown;

    try {
      await rollbackOnError(
        async () => {
          await update();
          await send();
          throw original;
        },
        { recovery: "best-effort" },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RollbackError);
    expect(thrown).toMatchObject({
      cause: original,
      result: {
        status: "partial",
        units: [
          {
            effectIds: ["email.rollback-best-effort"],
            status: "irreversible",
          },
          {
            effectIds: ["customer.rollback-best-effort"],
            status: "recovered",
          },
        ],
      },
    });
    expect(recovery).toHaveBeenCalledOnce();
  });

  it("preserves a recovery error and continues with remaining safe units", async () => {
    const events: string[] = [];
    const first = effect(
      "customer.rollback-safe-sibling",
      async () => undefined,
      {
        recover: async () => {
          events.push("recover:safe");
        },
      },
    );
    const recoveryFailure = new Error("recovery failed");
    const second = effect(
      "customer.rollback-failing-sibling",
      async () => undefined,
      {
        recover: async () => {
          events.push("recover:failing");
          throw recoveryFailure;
        },
      },
    );
    const original = new Error("callback failed");
    let thrown: unknown;

    try {
      await rollbackOnError(async () => {
        await first();
        await second();
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
        status: "partial",
        units: [
          {
            effectIds: ["customer.rollback-failing-sibling"],
            status: "failed",
          },
          {
            effectIds: ["customer.rollback-safe-sibling"],
            status: "recovered",
          },
        ],
      },
    });
    expect(events).toEqual(["recover:failing", "recover:safe"]);
  });

  it("waits for already-started effects to settle before planning rollback", async () => {
    let releaseEffect: (() => void) | undefined;
    const effectReleased = new Promise<void>((resolve) => {
      releaseEffect = resolve;
    });
    let noteEffectStarted: (() => void) | undefined;
    const effectStarted = new Promise<void>((resolve) => {
      noteEffectStarted = resolve;
    });
    let rejectSibling: ((error: Error) => void) | undefined;
    const sibling = new Promise<never>((_resolve, reject) => {
      rejectSibling = reject;
    });
    const recovery = vi.fn(async () => undefined);
    const update = effect(
      "customer.rollback-concurrent",
      async () => {
        noteEffectStarted?.();
        await effectReleased;
        return "updated";
      },
      { recover: recovery },
    );
    const original = new Error("parallel sibling failed");
    let settlement: unknown;
    const boundary = rollbackOnError(async () => {
      await Promise.all([update(), sibling]);
    });
    void boundary.then(
      () => {
        settlement = "resolved";
      },
      (error: unknown) => {
        settlement = error;
      },
    );

    await effectStarted;
    rejectSibling?.(original);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(settlement).toBeUndefined();
    releaseEffect?.();
    await expect(boundary).rejects.toBe(original);
    expect(recovery).toHaveBeenCalledOnce();
  });

  it("preserves callback cause when rollback fails before a result", async () => {
    const recoveryFailure = new Error("rollback could not start");
    const update = effect(
      "customer.rollback-pre-result-failure",
      async () => undefined,
      { recover: async () => undefined },
    );
    const original = new Error("callback failed");
    const now = vi.spyOn(Date, "now");
    let thrown: unknown;

    try {
      await rollbackOnError(async () => {
        await update();
        now.mockImplementationOnce(() => {
          throw recoveryFailure;
        });
        throw original;
      });
    } catch (error) {
      thrown = error;
    } finally {
      now.mockRestore();
    }

    expect(thrown).toBeInstanceOf(RollbackError);
    expect(thrown).toMatchObject({
      cause: original,
      recoveryError: recoveryFailure,
    });
    expect((thrown as RollbackError).result).toBeUndefined();
  });
});
