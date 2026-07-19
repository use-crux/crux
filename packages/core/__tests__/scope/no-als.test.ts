import { afterEach, describe, expect, it } from "vitest";
import { setAsyncScopeResolverForTesting } from "../../src/async-scope/internal/carrier";
import { currentScope, openScope, runScope } from "../../src/scope/internal";

describe("execution scopes without AsyncLocalStorage", () => {
  afterEach(() => {
    setAsyncScopeResolverForTesting(undefined);
  });

  it("preserves synchronous frames and fails closed across awaits", async () => {
    setAsyncScopeResolverForTesting(() => undefined);
    let synchronousScope: ReturnType<typeof currentScope>;
    let asynchronousScope: ReturnType<typeof currentScope>;

    await runScope({ kind: "invocation" }, {}, async (scope) => {
      synchronousScope = currentScope();
      expect(synchronousScope).toBe(scope);
      await Promise.resolve();
      asynchronousScope = currentScope();
    });

    expect(asynchronousScope).toBeUndefined();
    expect(currentScope()).toBeUndefined();
  });

  it("restores manual controller segments and close hooks synchronously", async () => {
    setAsyncScopeResolverForTesting(() => undefined);
    const controller = openScope({ kind: "adapter-call" }, {});
    let afterAwait: ReturnType<typeof currentScope>;
    let closingScope: ReturnType<typeof currentScope>;

    expect(controller.run(() => currentScope())).toBe(controller.scope);
    await controller.run(async () => {
      expect(currentScope()).toBe(controller.scope);
      await Promise.resolve();
      afterAwait = currentScope();
    });
    controller.scope.onClose(() => {
      closingScope = currentScope();
    });
    controller.seal("success");

    expect(afterAwait).toBeUndefined();
    expect(closingScope).toBe(controller.scope);
  });
});
