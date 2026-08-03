import { createWorkHost, flow, getWork, spawn } from "@use-crux/core";
import {
  createRuntimeProgram,
  createRuntimeWorker,
  node,
  type WorkId,
} from "@use-crux/core/runtime";
import { WorkResultExpiredError } from "@use-crux/core/work";
import { convexTest } from "convex-test";
import { makeFunctionReference, type FunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import schema from "../src/component/schema";
import {
  convexRuntimeStore,
  type ConvexRuntimeComponent,
} from "../src/runtime";
import type { ConvexCtxPort } from "../src/store";

const modules = {
  "../src/component/_generated/server.ts": () =>
    import("../src/component/_generated/server"),
  "../src/component/runtime/composite_deferred.ts": () =>
    import("../src/component/runtime/composite_deferred"),
  "../src/component/runtime/composite_events.ts": () =>
    import("../src/component/runtime/composite_events"),
  "../src/component/runtime/composite_outbox.ts": () =>
    import("../src/component/runtime/composite_outbox"),
  "../src/component/runtime/composite_state.ts": () =>
    import("../src/component/runtime/composite_state"),
  "../src/component/runtime/composite_timers.ts": () =>
    import("../src/component/runtime/composite_timers"),
  "../src/component/runtime/composite_transaction.ts": () =>
    import("../src/component/runtime/composite_transaction"),
  "../src/component/runtime/composite_utils.ts": () =>
    import("../src/component/runtime/composite_utils"),
  "../src/component/runtime/composite_waiters.ts": () =>
    import("../src/component/runtime/composite_waiters"),
  "../src/component/runtime/composites.ts": () =>
    import("../src/component/runtime/composites"),
  "../src/component/runtime/deferred.ts": () =>
    import("../src/component/runtime/deferred"),
  "../src/component/runtime/events.ts": () =>
    import("../src/component/runtime/events"),
  "../src/component/runtime/leases.ts": () =>
    import("../src/component/runtime/leases"),
  "../src/component/runtime/outbox.ts": () =>
    import("../src/component/runtime/outbox"),
  "../src/component/runtime/results.ts": () =>
    import("../src/component/runtime/results"),
  "../src/component/runtime/state.ts": () =>
    import("../src/component/runtime/state"),
  "../src/component/runtime/state_helpers.ts": () =>
    import("../src/component/runtime/state_helpers"),
  "../src/component/runtime/timers.ts": () =>
    import("../src/component/runtime/timers"),
  "../src/component/runtime/waiters.ts": () =>
    import("../src/component/runtime/waiters"),
} satisfies Record<string, () => Promise<unknown>>;

describe("Convex public Work persistence", () => {
  it("reconnects exported Flow Work to its exact result after independent host reconstruction", async () => {
    const test = convexTest({ schema, modules });
    const component = runtimeComponent();
    const namespace = "public-work-result";
    const executions: string[] = [];
    let resultPuts = 0;
    const review = flow(
      "convex-public-work-review",
      async (_scope, input: { readonly documentId: string }) => {
        executions.push(input.documentId);
        return { documentId: input.documentId, approved: true as const };
      },
    );
    const program = createRuntimeProgram({ targets: [review], transports: [] });
    const firstStore = convexRuntimeStore({ ctx: runtimeCtx(test), component });
    const firstHost = createWorkHost({
      runtime: node({
        store: firstStore,
        namespace,
        autoStartMaintenance: false,
      }),
      program,
    });

    try {
      const accepted = await firstHost.run(() =>
        spawn(review, { documentId: "doc_1" }, { idempotencyKey: "request_1" }),
      );
      expect(executions).toEqual([]);
      await expect(accepted.status()).resolves.toMatchObject({
        state: "queued",
      });
      const workId = accepted.id as WorkId;
      const [wake] = await firstStore.outbox.listByWork(workId, { namespace });
      if (!wake) throw new Error("Expected accepted Work wake.");
      const acceptedRow = await firstStore.state.getWork(workId, { namespace });
      if (!acceptedRow || acceptedRow.work.kind !== "flow.resume")
        throw new Error("Expected accepted Flow Work.");
      await expect(
        firstStore.state.getSnapshot(acceptedRow.work.flowId, { namespace }),
      ).resolves.toMatchObject({
        definition: expect.anything(),
        resultObligation: { kind: "required" },
      });
      firstHost.dispose();

      const replacementStore = convexRuntimeStore({
        ctx: runtimeCtx(test, (ref) => {
          if (ref === component.runtime.results?.put) resultPuts += 1;
        }),
        component,
      });
      const replacementHost = createWorkHost({
        runtime: node({
          store: replacementStore,
          namespace,
          autoStartMaintenance: false,
        }),
        program,
      });
      const worker = createRuntimeWorker({
        runtime: node({
          store: replacementStore,
          namespace,
          autoStartMaintenance: false,
        }),
        program,
        pollIntervalMs: 60_000,
      });
      try {
        const reconnected = await replacementHost.run(() =>
          getWork(review, accepted.id),
        );
        await expect.poll(() => executions).toEqual(["doc_1"]);
        await expect(reconnected.result()).resolves.toEqual({
          documentId: "doc_1",
          approved: true,
        });
        const completed = await replacementStore.state.getWork(workId, {
          namespace,
        });
        if (!completed?.resultRef)
          throw new Error("Expected retained Work result reference.");
        await replacementStore.results!.delete(completed.resultRef);
        await expect(reconnected.result()).rejects.toBeInstanceOf(
          WorkResultExpiredError,
        );
        await expect(
          worker.runtime.kernel.handleWake(wake.envelope),
        ).resolves.toMatchObject({ outcome: "duplicate" });
        expect(executions).toEqual(["doc_1"]);
        expect(resultPuts).toBe(1);
      } finally {
        replacementHost.dispose();
        await worker.stop();
      }
    } finally {
      firstHost.dispose();
    }
  });
});

function runtimeCtx(
  test: ReturnType<typeof convexTest>,
  onMutation?: (ref: unknown) => void,
): ConvexCtxPort {
  return {
    runQuery: async <TResult>() => undefined as TResult,
    runMutation: async <TResult>(
      ref: unknown,
      args: Record<string, unknown>,
    ) => {
      onMutation?.(ref);
      return await test.mutation(
        ref as FunctionReference<
          "mutation",
          "public",
          Record<string, unknown>,
          TResult
        >,
        args,
      );
    },
  };
}

function runtimeComponent(): ConvexRuntimeComponent {
  return {
    runtime: {
      state: {
        createWork: mutationRef("runtime/state:createWork"),
        getWork: mutationRef("runtime/state:getWork"),
        putWork: mutationRef("runtime/state:putWork"),
        listWork: mutationRef("runtime/state:listWork"),
        pruneTerminalWork: mutationRef("runtime/state:pruneTerminalWork"),
        countWork: mutationRef("runtime/state:countWork"),
        setWorkPending: mutationRef("runtime/state:setWorkPending"),
        getSnapshot: mutationRef("runtime/state:getSnapshot"),
        putSnapshot: mutationRef("runtime/state:putSnapshot"),
        pruneTerminalSnapshots: mutationRef(
          "runtime/state:pruneTerminalSnapshots",
        ),
        markSnapshotDelivered: mutationRef(
          "runtime/state:markSnapshotDelivered",
        ),
        hasIdempotencyKey: mutationRef("runtime/state:hasIdempotencyKey"),
        putIdempotencyKey: mutationRef("runtime/state:putIdempotencyKey"),
        pruneIdempotencyKeys: mutationRef("runtime/state:pruneIdempotencyKeys"),
        incrementIdle: mutationRef("runtime/state:incrementIdle"),
        decrementIdle: mutationRef("runtime/state:decrementIdle"),
        getIdleCount: mutationRef("runtime/state:getIdleCount"),
      },
      events: {
        append: mutationRef("runtime/events:append"),
        read: mutationRef("runtime/events:read"),
        prune: mutationRef("runtime/events:prune"),
      },
      waiters: {
        register: mutationRef("runtime/waiters:register"),
        resolve: mutationRef("runtime/waiters:resolve"),
        cancel: mutationRef("runtime/waiters:cancel"),
        attachTimer: mutationRef("runtime/waiters:attachTimer"),
        listByWork: mutationRef("runtime/waiters:listByWork"),
        claimExpired: mutationRef("runtime/waiters:claimExpired"),
        transition: mutationRef("runtime/waiters:transition"),
        prune: mutationRef("runtime/waiters:prune"),
      },
      timers: {
        put: mutationRef("runtime/timers:put"),
        get: mutationRef("runtime/timers:get"),
        claimDue: mutationRef("runtime/timers:claimDue"),
        list: mutationRef("runtime/timers:list"),
        listByWork: mutationRef("runtime/timers:listByWork"),
        transition: mutationRef("runtime/timers:transition"),
        prune: mutationRef("runtime/timers:prune"),
      },
      outbox: {
        put: mutationRef("runtime/outbox:put"),
        get: mutationRef("runtime/outbox:get"),
        claimPending: mutationRef("runtime/outbox:claimPending"),
        list: mutationRef("runtime/outbox:list"),
        listByWork: mutationRef("runtime/outbox:listByWork"),
        confirm: mutationRef("runtime/outbox:confirm"),
        retryLater: mutationRef("runtime/outbox:retryLater"),
        prune: mutationRef("runtime/outbox:prune"),
      },
      leases: {
        claim: mutationRef("runtime/leases:claim"),
        extend: mutationRef("runtime/leases:extend"),
        release: mutationRef("runtime/leases:release"),
      },
      deferred: {
        getScope: mutationRef("runtime/deferred:getScope"),
        createScope: mutationRef("runtime/deferred:createScope"),
        putScope: mutationRef("runtime/deferred:putScope"),
        listScopes: mutationRef("runtime/deferred:listScopes"),
        getIntent: mutationRef("runtime/deferred:getIntent"),
        createIntent: mutationRef("runtime/deferred:createIntent"),
        putIntent: mutationRef("runtime/deferred:putIntent"),
        listIntents: mutationRef("runtime/deferred:listIntents"),
      },
      results: {
        put: mutationRef("runtime/results:put"),
        get: mutationRef("runtime/results:get"),
        deleteResult: mutationRef("runtime/results:deleteResult"),
        pruneUnreferenced: mutationRef("runtime/results:pruneUnreferenced"),
      },
      composites: {
        run: mutationRef("runtime/composites:run"),
      },
    },
  };
}

function mutationRef(
  path: string,
): FunctionReference<"mutation", "public", Record<string, unknown>, unknown> {
  return makeFunctionReference(path);
}
