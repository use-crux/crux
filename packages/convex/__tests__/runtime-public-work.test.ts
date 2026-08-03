import { createWorkHost, flow, getWork, spawn } from "@use-crux/core";
import {
  createRuntimeProgram,
  createRuntimeWorker,
  node,
  type WorkId,
} from "@use-crux/core/runtime";
import { WorkResultExpiredError } from "@use-crux/core/work";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../src/component/schema";
import { convexRuntimeStore } from "../src/runtime";
import {
  runtimePublicWorkComponent,
  runtimePublicWorkCtx,
  runtimePublicWorkModules,
} from "./runtime-public-work-fixture";

describe("Convex public Work persistence", () => {
  it("reconnects exported Flow Work to its exact result after independent host reconstruction", async () => {
    const test = convexTest({ schema, modules: runtimePublicWorkModules });
    const component = runtimePublicWorkComponent();
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
    const firstStore = convexRuntimeStore({
      ctx: runtimePublicWorkCtx(test),
      component,
    });
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
        ctx: runtimePublicWorkCtx(test, (ref) => {
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
