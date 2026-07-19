import { afterEach, describe, expect, it, vi } from "vitest";
import {
  currentScope,
  currentScopeStack,
  openScope,
  runScope,
  type ExecutionScope,
} from "../../src/scope/internal";

describe("execution scope lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens around the handler and seals after scheduling close hooks", async () => {
    let observed: ExecutionScope | undefined;
    let releaseHook: (() => void) | undefined;
    const hookSettled = new Promise<void>((resolve) => {
      releaseHook = resolve;
    });

    const result = await runScope(
      { kind: "invocation", name: "request" },
      {},
      (scope) => {
        observed = scope;
        expect(scope.state).toBe("open");
        expect(currentScope()).toBe(scope);
        scope.onClose((outcome) => {
          expect(outcome).toBe("success");
          expect(scope.state).toBe("closing");
          return hookSettled;
        });
        return "handler-result";
      },
    );

    expect(result).toBe("handler-result");
    expect(observed?.state).toBe("sealed");
    expect(observed?.sealedReason).toBe("closed");
    releaseHook?.();
  });

  it("restores a manual scope for segments and seals timeout once", () => {
    const controller = openScope({ kind: "eval-cell", name: "case-1" }, {});
    const outcomes: string[] = [];

    expect(currentScope()).toBeUndefined();
    expect(controller.run(() => currentScope())).toBe(controller.scope);
    controller.scope.onClose((outcome) => outcomes.push(outcome));

    controller.seal("timeout");
    controller.seal("success");

    expect(controller.scope.state).toBe("sealed");
    expect(controller.scope.sealedReason).toBe("timeout");
    expect(outcomes).toEqual(["timeout"]);
  });

  it("gives runScope the same close semantics as an openScope controller", async () => {
    const manual = openScope({ kind: "tool" }, {});
    const manualOutcomes: string[] = [];
    const automaticOutcomes: string[] = [];
    manual.scope.onClose((outcome) => manualOutcomes.push(outcome));

    manual.seal("redirect");
    await runScope(
      { kind: "tool" },
      { classifyOutcome: () => "redirect" },
      (scope) => scope.onClose((outcome) => automaticOutcomes.push(outcome)),
    );

    expect(manualOutcomes).toEqual(["redirect"]);
    expect(automaticOutcomes).toEqual(manualOutcomes);
    expect(manual.scope.sealedReason).toBe("closed");
  });

  it.each([
    ["success", "closed"],
    ["redirect", "closed"],
    ["not-found", "closed"],
    ["error", "error"],
    ["cancelled", "cancelled"],
    ["timeout", "timeout"],
  ] as const)("maps %s closure to the %s sealed reason", (outcome, reason) => {
    const controller = openScope({ kind: "invocation" }, {});
    controller.seal(outcome);
    expect(controller.scope.sealedReason).toBe(reason);
  });

  it("reports nested descriptors nearest-first with invocation-local generated ids", async () => {
    await runScope({ kind: "invocation" }, {}, async (root) => {
      expect(root.descriptor.id).toBe("invocation:1");

      await runScope({ kind: "tool", name: "search" }, {}, (child) => {
        expect(child.parent).toBe(root);
        expect(child.root).toBe(root);
        expect(child.descriptor.id).toBe("tool:2");
        expect(currentScopeStack()).toEqual([
          child.descriptor,
          root.descriptor,
        ]);
      });
    });
  });

  it("contains synchronous close-hook failures and preserves registration order", async () => {
    const diagnostics = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls: string[] = [];

    await runScope({ kind: "invocation" }, {}, (scope) => {
      scope.onClose(() => {
        calls.push("first");
        throw new Error("close failed");
      });
      scope.onClose(() => {
        calls.push("second");
      });
    });

    expect(calls).toEqual(["first", "second"]);
    expect(diagnostics).toHaveBeenCalledOnce();
  });

  it("rejects asynchronous outcome classifiers and still seals the scope", async () => {
    let observed: ExecutionScope | undefined;

    await expect(
      runScope(
        { kind: "invocation" },
        {
          classifyOutcome: (() => Promise.resolve("success")) as never,
        },
        (scope) => {
          observed = scope;
        },
      ),
    ).rejects.toThrow("Scope classifyOutcome must return synchronously.");

    expect(observed?.state).toBe("sealed");
    expect(observed?.sealedReason).toBe("error");
  });

  it("rethrows the original handler failure after sealing", async () => {
    const failure = new Error("handler failed");
    let observed: ExecutionScope | undefined;

    await expect(
      runScope({ kind: "invocation" }, {}, (scope) => {
        observed = scope;
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(observed?.sealedReason).toBe("error");
  });
});
