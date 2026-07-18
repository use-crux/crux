import { describe, expect, it, vi } from "vitest";
import {
  defer,
  getExecutionContext,
  runWithExecutionContext,
} from "@use-crux/core";
import {
  runWithDeferInvocation,
  type DeferInvocationOutcome,
} from "@use-crux/core/internal/scope";
import { testLifetime } from "./test-lifetime";
import { trackDeferCommit } from "../../src/defer/internal/context";

describe("runWithDeferInvocation()", () => {
  it("registers lazily, returns void, and hands drain work to the host boundary", async () => {
    const callback = vi.fn();
    let scheduled: (() => Promise<void>) | undefined;
    let registrationResult: unknown;

    const value = await runWithDeferInvocation(
      () => {
        registrationResult = defer(callback);
        return { status: 200 };
      },
      {
        lifetime: testLifetime((task) => {
          scheduled = task;
        }),
        classifyOutcome: () => "success",
      },
    );

    expect(value).toEqual({ status: 200 });
    expect(registrationResult).toBeUndefined();
    expect(callback).not.toHaveBeenCalled();
    expect(scheduled).toBeTypeOf("function");

    await scheduled?.();
    expect(callback).toHaveBeenCalledOnce();
  });

  it("linearizes sealing against late registrations from the handler scope", async () => {
    let releaseLate: (() => void) | undefined;
    const lateGate = new Promise<void>((resolve) => {
      releaseLate = resolve;
    });
    let lateRegistration: Promise<unknown> | undefined;

    await runWithDeferInvocation(
      () => {
        lateRegistration = lateGate.then(() => defer(() => {}));
        return "response";
      },
      {
        lifetime: testLifetime(() => {}),
        classifyOutcome: () => "success",
      },
    );

    releaseLate?.();
    await expect(lateRegistration).rejects.toEqual(
      expect.objectContaining({ code: "DEFER_SCOPE_SEALED" }),
    );
  });

  it.each<[DeferInvocationOutcome, boolean]>([
    ["success", true],
    ["error", false],
    ["redirect", true],
    ["not-found", true],
    ["cancelled", false],
  ])("gates callbacks after a %s logical outcome", async (outcome, runs) => {
    const callback = vi.fn();
    let scheduled: (() => Promise<void>) | undefined;

    await runWithDeferInvocation(
      () => {
        defer(callback);
        return "response";
      },
      {
        lifetime: testLifetime((task) => {
          scheduled = task;
        }),
        classifyOutcome: () => outcome,
      },
    );

    expect(callback).not.toHaveBeenCalled();
    await scheduled?.();
    expect(callback).toHaveBeenCalledTimes(runs ? 1 : 0);
  });

  it("preserves returned and thrown values by identity", async () => {
    const returned = { status: 204 };
    const thrown = new Error("handler failed");

    await expect(
      runWithDeferInvocation(() => returned, {
        lifetime: testLifetime(() => {}),
        classifyOutcome: (settlement) => {
          expect(settlement).toEqual({ kind: "returned", value: returned });
          return "success";
        },
      }),
    ).resolves.toBe(returned);

    await expect(
      runWithDeferInvocation(
        () => {
          throw thrown;
        },
        {
          lifetime: testLifetime(() => {}),
          classifyOutcome: (settlement) => {
            expect(settlement).toEqual({ kind: "thrown", error: thrown });
            return "error";
          },
        },
      ),
    ).rejects.toBe(thrown);
  });

  it("rejects an async outcome classifier supplied by untyped JavaScript", async () => {
    await expect(
      runWithDeferInvocation(() => "response", {
        lifetime: testLifetime(() => {}),
        classifyOutcome: (() => Promise.resolve("success")) as never,
      }),
    ).rejects.toThrow("classifyOutcome must return synchronously");
  });

  it("discards a returned value when the strict commit barrier fails", async () => {
    const commitFailure = new Error("durable acceptance failed");

    await expect(
      runWithDeferInvocation(
        () => {
          trackDeferCommit(Promise.reject(commitFailure));
          return { status: 200 };
        },
        {
          lifetime: testLifetime(() => {}),
          classifyOutcome: () => "success",
        },
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "DEFER_COMMIT_FAILED",
        cause: commitFailure,
      }),
    );
  });

  it("isolates concurrent invocation callbacks and restores their causal context", async () => {
    const scheduled = new Map<string, () => Promise<void>>();
    const seen: string[] = [];

    await Promise.all(
      ["first", "second"].map((requestId) =>
        runWithExecutionContext({ sessionId: requestId }, () =>
          runWithDeferInvocation(
            async () => {
              await Promise.resolve();
              defer(() => {
                seen.push(getExecutionContext()?.sessionId ?? "missing");
              });
            },
            {
              lifetime: testLifetime((task) => {
                scheduled.set(requestId, task);
              }),
              classifyOutcome: () => "success",
            },
          ),
        ),
      ),
    );

    await Promise.all([
      scheduled.get("second")?.(),
      scheduled.get("first")?.(),
    ]);
    expect(seen).toEqual(["second", "first"]);
  });

  it("returns after committed without awaiting an immediately scheduled drain", async () => {
    let releaseCallback: (() => void) | undefined;
    const callbackGate = new Promise<void>((resolve) => {
      releaseCallback = resolve;
    });
    let drain: Promise<void> | undefined;

    const response = runWithDeferInvocation(
      () => {
        defer(() => callbackGate);
        return "response";
      },
      {
        lifetime: testLifetime((task) => {
          drain = task();
        }),
        classifyOutcome: () => "success",
      },
    );

    await expect(response).resolves.toBe("response");
    let drainSettled = false;
    void drain?.then(() => {
      drainSettled = true;
    });
    await Promise.resolve();
    expect(drainSettled).toBe(false);

    releaseCallback?.();
    await expect(drain).resolves.toBeUndefined();
  });

  it("uses the nearest nested invocation scope and restores the parent scope", async () => {
    let outerTask: (() => Promise<void>) | undefined;
    let innerTask: (() => Promise<void>) | undefined;
    const runs: string[] = [];

    await runWithDeferInvocation(
      async () => {
        defer(() => {
          runs.push("outer-before");
        });
        await runWithDeferInvocation(
          () => {
            defer(() => {
              runs.push("inner");
            });
          },
          {
            lifetime: testLifetime((task) => {
              innerTask = task;
            }),
            classifyOutcome: () => "success",
          },
        );
        defer(() => {
          runs.push("outer-after");
        });
      },
      {
        lifetime: testLifetime((task) => {
          outerTask = task;
        }),
        classifyOutcome: () => "success",
      },
    );

    await innerTask?.();
    await outerTask?.();
    expect(runs).toEqual(["inner", "outer-before", "outer-after"]);
  });
});
