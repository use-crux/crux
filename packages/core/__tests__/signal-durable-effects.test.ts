import { afterEach, describe, expect, it } from "vitest";
import { config, flow, signal } from "@use-crux/core";
import type { EffectScopeRef } from "@use-crux/core/effect";
import { node } from "@use-crux/core/runtime";
import { resetHooks } from "../src/runtime/runtime";
import { z } from "zod";
import {
  durableMemoryRuntimeStore,
  expectFlowStatus,
} from "./signal-durable-test-helpers";

afterEach(() => {
  resetHooks();
});

describe("durable Signal Flow Effects integration", () => {
  it("retains one Effect scope when Signal publication resumes a suspended Flow", async () => {
    const store = durableMemoryRuntimeStore();
    const namespace = "signal-flow-effects-test";
    const crux = config({
      runtime: node({
        store,
        namespace,
        autoStartMaintenance: false,
      }),
    });
    const approved = signal({
      id: "publication.effects-approved",
      schema: z.object({ approved: z.literal(true) }),
    });
    const observedScopes: EffectScopeRef[] = [];
    const publication = flow(
      "effects-preserving publication",
      { signals: { approved } },
      async (scope) => {
        observedScopes.push(scope.effects);
        await scope.waitFor(approved);
      },
    );

    try {
      const suspended = await publication.run({
        flowId: "flow_signal_effects",
      });
      expect(suspended).toMatchObject({
        status: "suspended",
        effects: {
          kind: "effect.scope",
          id: expect.any(String),
          runId: suspended.flowId,
        },
      });
      const suspendedSnapshot = await store.state.getSnapshot(
        suspended.flowId,
        { namespace },
      );
      expect(suspendedSnapshot?.effects).toEqual(suspended.effects);

      await approved.publish({ approved: true });
      await expectFlowStatus(store, namespace, suspended.flowId, "completed");

      const completedSnapshot = await store.state.getSnapshot(
        suspended.flowId,
        { namespace },
      );
      expect(completedSnapshot?.effects).toEqual(suspended.effects);
      expect(observedScopes).toEqual([suspended.effects, suspended.effects]);
    } finally {
      crux.dispose();
    }
  });
});
