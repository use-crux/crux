import { afterEach, describe, expect, it, vi } from "vitest";
import { defer } from "@use-crux/core";
import { durableTask } from "@use-crux/core/runtime";
import { createTestRuntime } from "@use-crux/core/runtime/testing";
import type {
  DeferLifetimeCapability,
  DeferScheduledTask,
} from "@use-crux/core/internal/defer-host";
import { createInvocationDeferScope } from "../../src/defer/internal/invocation-scope";
import { scheduleDiagnosticsOnlyDeferredCallback } from "../../src/defer/internal/port";
import { runWithDeferRegistration } from "../../src/defer/internal/context";
import { getHooks, setHooks } from "../../src/runtime/runtime";
import { testLifetime } from "./test-lifetime";

describe("deferred callback boundary", () => {
  const previousHooks = getHooks();

  afterEach(() => {
    setHooks(previousHooks);
  });

  it("gives concurrent callbacks distinct named commit scopes", async () => {
    const target = callbackTarget("callback-distinct-scopes");
    const runtime = createTestRuntime({ targets: [target] });
    const retained = retainedLifetime({ concurrency: 2 });
    try {
      const parent = createInvocationDeferScope(retained.lifetime);
      parent.registerInline(
        () => defer(target, { id: "first" }),
        handlerRegistration(parent),
      );
      parent.registerInline(
        () => defer(target, { id: "second" }),
        handlerRegistration(parent),
      );

      const handle = parent.seal("success");
      await retained.runOnlyTask();
      await expect(handle.settled).resolves.toMatchObject({
        callbacks: [
          { sequence: 0, outcome: "completed" },
          { sequence: 1, outcome: "completed" },
        ],
      });

      const scopes = await runtime.store.deferred.listScopes({
        namespace: "local",
      });
      expect(scopes).toHaveLength(2);
      expect(new Set(scopes.map((scope) => scope.scopeId)).size).toBe(2);
      expect(scopes).toEqual([
        expect.objectContaining({
          finalization: expect.objectContaining({ state: "finalized" }),
        }),
        expect.objectContaining({
          finalization: expect.objectContaining({ state: "finalized" }),
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("tracks unawaited named staging through callback commit", async () => {
    const target = callbackTarget("callback-unawaited-named");
    const runtime = createTestRuntime({ targets: [target] });
    const retained = retainedLifetime();
    try {
      const parent = createInvocationDeferScope(retained.lifetime);
      let workId: string | undefined;
      parent.registerInline(() => {
        void defer(target, { id: "unawaited" }).then((work) => {
          workId = work.workId;
        });
      }, handlerRegistration(parent));

      const handle = parent.seal("success");
      await retained.runOnlyTask();
      await expect(handle.settled).resolves.toMatchObject({
        callbacks: [{ outcome: "completed" }],
      });
      expect(workId).toBeDefined();
      await expect(
        runtime.store.state.getWork(workId!, { namespace: "local" }),
      ).resolves.toMatchObject({ status: "pending" });
    } finally {
      runtime.dispose();
    }
  });

  it("reports nested commit failure with the required causal chain and continues siblings", async () => {
    const target = callbackTarget("callback-commit-failure");
    const runtime = createTestRuntime({ targets: [target] });
    const retained = retainedLifetime({ concurrency: 2 });
    const sibling = vi.fn();
    try {
      const parent = createInvocationDeferScope(retained.lifetime);
      parent.registerInline(() => {
        void (
          defer as unknown as (
            value: unknown,
            input: unknown,
          ) => Promise<unknown>
        )(target, { invalid: () => undefined }).catch(() => undefined);
      }, handlerRegistration(parent));
      parent.registerInline(sibling, handlerRegistration(parent));

      const handle = parent.seal("success");
      await retained.runOnlyTask();
      const result = await handle.settled;

      expect(result.callbacks[0]).toMatchObject({
        outcome: "failed",
        error: {
          code: "DEFER_CALLBACK_FAILED",
          cause: { code: "DEFER_COMMIT_FAILED" },
        },
      });
      expect(sibling).toHaveBeenCalledOnce();
      expect(result.callbacks[1]).toMatchObject({ outcome: "completed" });
    } finally {
      runtime.dispose();
    }
  });

  it("finalizes accepted named work with the callback error outcome", async () => {
    const target = callbackTarget("callback-error-outcome");
    const runtime = createTestRuntime({ targets: [target] });
    const retained = retainedLifetime();
    try {
      const parent = createInvocationDeferScope(retained.lifetime);
      parent.registerInline(async () => {
        await defer(target, { id: "accepted" });
        throw new Error("callback failed after staging");
      }, handlerRegistration(parent));

      const handle = parent.seal("success");
      await retained.runOnlyTask();

      await expect(handle.settled).resolves.toMatchObject({
        callbacks: [
          {
            outcome: "failed",
            error: { code: "DEFER_CALLBACK_FAILED" },
          },
        ],
      });
      await expect(
        runtime.store.deferred.listScopes({ namespace: "local" }),
      ).resolves.toEqual([
        expect.objectContaining({
          finalization: expect.objectContaining({
            state: "finalized",
            outcome: "error",
          }),
        }),
      ]);
      await expect(
        runtime.store.state.listWork({
          namespace: "local",
          status: "pending",
        }),
      ).resolves.toHaveLength(1);
    } finally {
      runtime.dispose();
    }
  });

  it("delegates nested inline work to the parent drain without scheduling another drain", async () => {
    const retained = retainedLifetime();
    const nested = vi.fn();
    const parent = createInvocationDeferScope(retained.lifetime);
    parent.registerInline(() => defer(nested), handlerRegistration(parent));

    const handle = parent.seal("success");
    expect(retained.tasks).toHaveLength(1);
    await retained.runOnlyTask();

    expect(retained.tasks).toHaveLength(1);
    expect(nested).toHaveBeenCalledOnce();
    await expect(handle.settled).resolves.toMatchObject({
      callbacks: [
        { sequence: 0, outcome: "completed" },
        { sequence: 1, outcome: "completed" },
      ],
    });
  });

  it("schedules diagnostics-only callbacks through the same bounded parent drain", async () => {
    const retained = retainedLifetime();
    const callback = vi.fn();
    const parent = createInvocationDeferScope(retained.lifetime);
    runWithDeferRegistration(handlerRegistration(parent), () => {
      scheduleDiagnosticsOnlyDeferredCallback(callback);
    });

    const handle = parent.seal("success");
    await retained.runOnlyTask();

    expect(callback).toHaveBeenCalledOnce();
    await expect(handle.settled).resolves.toMatchObject({
      callbacks: [{ sequence: 0, outcome: "completed" }],
    });
  });
});

function callbackTarget(name: string) {
  return durableTask(name, {
    run: async (input: { readonly id: string }) => input.id,
  });
}

function handlerRegistration(
  scope: ReturnType<typeof createInvocationDeferScope>,
) {
  return { scope, phase: "handler" as const, depth: 0 };
}

function retainedLifetime(
  limits: Partial<DeferLifetimeCapability["limits"]> = {},
) {
  const tasks: DeferScheduledTask[] = [];
  const lifetime: DeferLifetimeCapability = {
    ...testLifetime((_run, task) => tasks.push(task), limits),
    durableFinalization: true,
  };
  return {
    lifetime,
    tasks,
    async runOnlyTask() {
      expect(tasks).toHaveLength(1);
      await tasks[0]!.run();
    },
  };
}
