import { describe, expect, it, vi } from "vitest";
import { defer } from "@use-crux/core";
import { durableTask } from "@use-crux/core/runtime";
import { createTestRuntime } from "@use-crux/core/runtime/testing";
import {
  runWithDeferInvocation,
  type DeferLifetimeCapability,
} from "@use-crux/core/internal/scope";
import { testLifetime } from "./test-lifetime";

describe("named defer() recovery edges", () => {
  it("keeps a live long-running scope leased beyond its initial TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-12T00:00:00.000Z"));
    const target = durableTask("long-running-defer-target", {
      run: async (input: { readonly id: string }) => input.id,
    });
    const testRuntime = createTestRuntime({ targets: [target] });
    let continueHandler: (() => void) | undefined;
    const handlerGate = new Promise<void>((resolve) => {
      continueHandler = resolve;
    });
    let staged: (() => void) | undefined;
    const stagedGate = new Promise<void>((resolve) => {
      staged = resolve;
    });
    try {
      const invocation = runWithDeferInvocation(
        async () => {
          await defer(target, { id: "1" });
          staged?.();
          await handlerGate;
          return "response";
        },
        {
          lifetime: namedLifetime(),
          classifyOutcome: () => "success",
        },
      );
      await stagedGate;

      await vi.advanceTimersByTimeAsync(60_001);
      await expect(
        testRuntime.runtime.kernel.maintenanceTick({
          namespace: "local",
          now: new Date(),
        }),
      ).resolves.toMatchObject({ deferredScopesAbandoned: 0 });

      continueHandler?.();
      await expect(invocation).resolves.toBe("response");
      await expect(
        testRuntime.store.deferred.listScopes({ namespace: "local" }),
      ).resolves.toEqual([
        expect.objectContaining({
          finalization: expect.objectContaining({ state: "finalized" }),
        }),
      ]);
    } finally {
      testRuntime.dispose();
      vi.useRealTimers();
    }
  });

  it("retains released work when response delivery fails after durable finalization", async () => {
    const target = durableTask("response-loss-target", {
      run: async (input: { readonly id: string }) => input.id,
    });
    const testRuntime = createTestRuntime({ targets: [target] });
    try {
      const reference = await runWithDeferInvocation(
        () => defer(target, { id: "1" }),
        {
          lifetime: namedLifetime(),
          classifyOutcome: () => "success",
        },
      );
      const responseDelivery = Promise.reject(
        new Error("client disconnected before receiving response"),
      );
      await expect(responseDelivery).rejects.toThrow("client disconnected");
      await expect(
        testRuntime.store.state.getWork(reference.workId, {
          namespace: "local",
        }),
      ).resolves.toMatchObject({ status: "pending" });
    } finally {
      testRuntime.dispose();
    }
  });
});

function namedLifetime(): DeferLifetimeCapability {
  return {
    ...testLifetime(() => {}),
    durableFinalization: true,
  };
}
