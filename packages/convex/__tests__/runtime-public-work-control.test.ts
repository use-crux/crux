import { createWorkHost, flow, getWork, spawn } from "@use-crux/core";
import { createRuntimeProgram, node } from "@use-crux/core/runtime";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../src/component/schema";
import { convexRuntimeStore } from "../src/runtime";
import {
  runtimePublicWorkComponent,
  runtimePublicWorkCtx,
  runtimePublicWorkModules,
} from "./runtime-public-work-fixture";

describe("Convex public Work control persistence", () => {
  it("reconstructs progress, ownership, statistics, streams, and cancellation", async () => {
    const test = convexTest({ schema, modules: runtimePublicWorkModules });
    const component = runtimePublicWorkComponent();
    const namespace = "public-work-control";
    const review = flow("convex-public-work-control", async () => "done");
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
        spawn(review, { idempotencyKey: "request_1" }),
      );
      await accepted.progress({ message: "Persisted", current: 1, total: 2 });
      await accepted.detach();
      const beforeRestart = await accepted.stats();
      firstHost.dispose();

      const replacementStore = convexRuntimeStore({
        ctx: runtimePublicWorkCtx(test),
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
      try {
        const reconnected = await replacementHost.run(() =>
          getWork(review, accepted.id),
        );
        await expect(reconnected.status()).resolves.toMatchObject({
          state: "queued",
          progress: { message: "Persisted", current: 1, total: 2 },
          ownership: { state: "detached", reason: "explicit" },
        });
        await expect(reconnected.stats()).resolves.toEqual(beforeRestart);

        const iterator = reconnected.stream()[Symbol.asyncIterator]();
        await iterator.next();
        const terminal = iterator.next();
        await reconnected.cancel({ reason: "No longer needed" });
        await expect(terminal).resolves.toMatchObject({
          value: {
            status: { state: "cancelled", reason: "No longer needed" },
          },
        });
        await expect(iterator.next()).resolves.toEqual({
          done: true,
          value: undefined,
        });
      } finally {
        replacementHost.dispose();
      }
    } finally {
      firstHost.dispose();
    }
  });
});
