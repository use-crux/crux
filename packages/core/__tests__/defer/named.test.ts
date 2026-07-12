import { afterEach, describe, expect, it } from "vitest";
import { defer } from "@use-crux/core";
import { durableTask } from "@use-crux/core/runtime";
import { createTestRuntime } from "@use-crux/core/runtime/testing";
import { runWithDeferInvocation } from "@use-crux/core/internal/defer-host";
import type { DeferLifetimeCapability } from "@use-crux/core/internal/defer-host";
import { getHooks, setHooks } from "../../src/runtime/runtime";
import { testLifetime } from "./test-lifetime";

describe("named defer()", () => {
  const previousHooks = getHooks();

  afterEach(() => {
    setHooks(previousHooks);
  });

  it("resolves after durable staging and releases work only when the invocation finalizes", async () => {
    const target = durableTask("send-deferred-email", {
      run: async (input: { readonly messageId: string }) => input.messageId,
    });
    const testRuntime = createTestRuntime({ targets: [target] });
    try {
      let stagedWorkId: string | undefined;
      const result = await runWithDeferInvocation(
        async () => {
          const reference = await defer(target, { messageId: "message_1" });
          stagedWorkId = reference.workId;
          expect(reference).toEqual({
            kind: "deferred.work",
            workId: reference.workId,
            targetId: "send-deferred-email",
          });
          expect(Object.isFrozen(reference)).toBe(true);
          await expect(
            testRuntime.store.state.getWork(reference.workId, {
              namespace: "local",
            }),
          ).resolves.toBeNull();
          await expect(
            testRuntime.store.deferred.listIntents({
              namespace: "local",
              scopeId: (
                await testRuntime.store.deferred.listScopes({
                  namespace: "local",
                  state: "open",
                })
              )[0]!.scopeId,
            }),
          ).resolves.toEqual([
            expect.objectContaining({
              workId: reference.workId,
              state: "staged",
            }),
          ]);
          return "response";
        },
        {
          lifetime: namedLifetime(),
          classifyOutcome: () => "success",
        },
      );

      expect(result).toBe("response");
      expect(stagedWorkId).toBeDefined();
      await expect(
        testRuntime.store.state.getWork(stagedWorkId!, {
          namespace: "local",
        }),
      ).resolves.toMatchObject({ status: "pending" });
      await expect(
        testRuntime.store.outbox.list({
          namespace: "local",
          state: "pending",
        }),
      ).resolves.toHaveLength(1);
    } finally {
      testRuntime.dispose();
    }
  });

  it("poisons the host commit when named work has no Runtime", async () => {
    setHooks({});
    const target = durableTask("runtime-required-target", {
      run: async (input: { readonly id: string }) => input.id,
    });
    let callerError: unknown;

    await expect(
      runWithDeferInvocation(
        async () => {
          await defer(target, { id: "1" }).catch((error: unknown) => {
            callerError = error;
          });
          return "response";
        },
        {
          lifetime: namedLifetime(),
          classifyOutcome: () => "success",
        },
      ),
    ).rejects.toMatchObject({
      code: "DEFER_COMMIT_FAILED",
      cause: { code: "RUNTIME_REQUIRED" },
    });
    expect(callerError).toEqual(
      expect.objectContaining({ code: "RUNTIME_REQUIRED" }),
    );
  });

  it("abandons staged work when atomic finalization fails", async () => {
    const target = durableTask("commit-failure-target", {
      run: async (input: { readonly id: string }) => input.id,
    });
    const testRuntime = createTestRuntime({ targets: [target] });
    try {
      await expect(
        runWithDeferInvocation(
          async () => {
            await defer(target, { id: "1" });
            testRuntime.store.testing.failAfter(0);
            return "discard-me";
          },
          {
            lifetime: namedLifetime(),
            classifyOutcome: () => "success",
          },
        ),
      ).rejects.toMatchObject({ code: "DEFER_COMMIT_FAILED" });
      await expect(
        testRuntime.store.deferred.listScopes({ namespace: "local" }),
      ).resolves.toEqual([
        expect.objectContaining({
          finalization: expect.objectContaining({ state: "abandoned" }),
        }),
      ]);
      await expect(
        testRuntime.store.outbox.list({ namespace: "local" }),
      ).resolves.toEqual([]);
    } finally {
      testRuntime.dispose();
    }
  });

  it("abandons an accepted sibling when a later named registration fails", async () => {
    const target = durableTask("sibling-staging-target", {
      run: async (input: { readonly id: string }) => input.id,
    });
    const testRuntime = createTestRuntime({ targets: [target] });
    try {
      let firstWorkId: string | undefined;
      await expect(
        runWithDeferInvocation(
          async () => {
            firstWorkId = (await defer(target, { id: "accepted" })).workId;
            await (
              defer as unknown as (
                value: unknown,
                input: unknown,
              ) => Promise<unknown>
            )(target, { id: () => "invalid" }).catch(() => undefined);
            return "discard-me";
          },
          {
            lifetime: namedLifetime(),
            classifyOutcome: () => "success",
          },
        ),
      ).rejects.toMatchObject({ code: "DEFER_COMMIT_FAILED" });
      const intents = await testRuntime.store.deferred.listIntents({
        namespace: "local",
        scopeId: (
          await testRuntime.store.deferred.listScopes({
            namespace: "local",
          })
        )[0]!.scopeId,
      });
      expect(intents).toEqual([
        expect.objectContaining({ workId: firstWorkId, state: "abandoned" }),
      ]);
      await expect(
        testRuntime.store.state.getWork(firstWorkId!, { namespace: "local" }),
      ).resolves.toBeNull();
    } finally {
      testRuntime.dispose();
    }
  });

  it.each([
    {
      name: "omits its required input",
      invoke: (target: ReturnType<typeof durableDiagnosticTarget>) =>
        (defer as unknown as (value: unknown) => Promise<unknown>)(target),
      causeCode: "DEFER_TARGET_INPUT_REQUIRED",
    },
    {
      name: "uses a non-JSON input",
      invoke: (target: ReturnType<typeof durableDiagnosticTarget>) =>
        (
          defer as unknown as (
            value: unknown,
            input: unknown,
          ) => Promise<unknown>
        )(target, { callback: () => undefined }),
      causeCode: "PAYLOAD_NOT_JSON",
    },
  ])(
    "poisons host commit when named work $name",
    async ({ invoke, causeCode }) => {
      const target = durableDiagnosticTarget();
      const testRuntime = createTestRuntime({ targets: [target] });
      try {
        let callerError: unknown;
        await expect(
          runWithDeferInvocation(
            async () => {
              await invoke(target).catch((error: unknown) => {
                callerError = error;
              });
              return "discard-me";
            },
            {
              lifetime: namedLifetime(),
              classifyOutcome: () => "success",
            },
          ),
        ).rejects.toMatchObject({
          code: "DEFER_COMMIT_FAILED",
          cause: { code: causeCode },
        });
        expect(callerError).toEqual(
          expect.objectContaining({ code: causeCode }),
        );
      } finally {
        testRuntime.dispose();
      }
    },
  );

  it("refuses named work when the host cannot finalize before response commitment", async () => {
    const target = durableDiagnosticTarget();
    const testRuntime = createTestRuntime({ targets: [target] });
    try {
      await expect(
        runWithDeferInvocation(
          async () => {
            await defer(target, { id: "1" }).catch(() => undefined);
            return "discard-me";
          },
          {
            lifetime: testLifetime(() => {}),
            classifyOutcome: () => "success",
          },
        ),
      ).rejects.toMatchObject({
        code: "DEFER_COMMIT_FAILED",
        cause: { code: "DEFER_CAPABILITY_MISSING" },
      });
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

function durableDiagnosticTarget() {
  return diagnosticTarget;
}

const diagnosticTarget = durableTask("defer-diagnostic-target", {
  run: async (input: { readonly id: string }) => input.id,
});
