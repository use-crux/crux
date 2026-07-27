import { describe, expect, expectTypeOf, it } from "vitest";

import {
  evalContext,
  tryEvalContext,
  type EvalTaskContext,
} from "@use-crux/core/eval";
import { withEvalContext } from "@use-crux/core/eval/testing";
import { runWithEvalTaskContext } from "../../src/eval/internal/task-context-scope";

describe("Eval task context", () => {
  it("is available only within its frozen, isolated async task scope", async () => {
    expect(tryEvalContext()).toBeUndefined();
    expect(() => evalContext()).toThrowError(
      new TypeError(
        "evalContext() is only available while an Eval task is running.",
      ),
    );

    const firstInput: EvalTaskContext = {
      signal: new AbortController().signal,
      timeout: { stepMs: 100, tools: { search: null } },
    };
    const secondInput: EvalTaskContext = {
      signal: new AbortController().signal,
      timeout: {},
    };

    const first = runWithEvalTaskContext(firstInput, async () => {
      const beforeAwait = evalContext();
      expect(tryEvalContext()).toBe(beforeAwait);
      expect(beforeAwait).not.toBe(firstInput);
      expect(Object.isFrozen(beforeAwait)).toBe(true);
      expect(Object.isFrozen(beforeAwait.timeout)).toBe(true);
      expect(Object.isFrozen(beforeAwait.timeout.tools)).toBe(true);
      await Promise.resolve();
      return { beforeAwait, afterAwait: evalContext() };
    });
    const second = runWithEvalTaskContext(secondInput, async () => {
      await Promise.resolve();
      return evalContext();
    });

    const [firstContexts, secondContext] = await Promise.all([first, second]);
    expect(secondContext.signal).toBe(secondInput.signal);
    expect(secondContext).not.toBe(tryEvalContext());

    expect(firstContexts.afterAwait).toBe(firstContexts.beforeAwait);
    expect(firstContexts.beforeAwait.signal).toBe(firstInput.signal);
    expect(firstContexts.beforeAwait).not.toBe(secondContext);
    expect(tryEvalContext()).toBeUndefined();
  });

  it("rejects malformed testing contexts before installing them", () => {
    expect(() =>
      withEvalContext(
        { signal: {}, timeout: {} } as EvalTaskContext,
        () => undefined,
      ),
    ).toThrowError(
      new TypeError("Eval task context requires a valid AbortSignal."),
    );
    expect(() =>
      withEvalContext(
        {
          signal: new AbortController().signal,
          timeout: { totalMs: 100 },
        } as unknown as EvalTaskContext,
        () => undefined,
      ),
    ).toThrowError(
      new TypeError(
        "Eval task context timeout accepts only nested timeout budgets.",
      ),
    );
    expect(tryEvalContext()).toBeUndefined();
  });

  it("returns synchronous and asynchronous callback results unchanged", () => {
    const context: EvalTaskContext = {
      signal: new AbortController().signal,
      timeout: {},
    };
    const syncResult = Object.freeze({ kind: "sync" });
    const asyncResult = Promise.resolve("async");

    const returnedSyncResult = withEvalContext(context, () => syncResult);
    const returnedAsyncResult = withEvalContext(context, () => asyncResult);

    expectTypeOf(returnedSyncResult).toEqualTypeOf<typeof syncResult>();
    expectTypeOf(returnedAsyncResult).toEqualTypeOf<typeof asyncResult>();
    expect(returnedSyncResult).toBe(syncResult);
    expect(returnedAsyncResult).toBe(asyncResult);
  });
});
