import { afterEach, describe, expect, it } from "vitest";
import { config, flow, signal } from "@use-crux/core";
import { createRuntime, node, type FlowId } from "@use-crux/core/runtime";
import type { SignalOccurrence } from "@use-crux/core/signal";
import { z } from "zod";
import {
  runtimeTargetMap,
  type RuntimeTargetRuntimeRef,
} from "../src/runtime/api/target-registry";
import { resetHooks } from "../src/runtime/runtime";
import {
  deferred,
  durableMemoryRuntimeStore,
  expectFlowStatus,
  expectWaiterCounts,
} from "./signal-durable-test-helpers";

afterEach(() => {
  resetHooks();
});

describe("durable Signal payload persistence", () => {
  it("preserves negative zero and immutable detached payloads through replay", async () => {
    const store = durableMemoryRuntimeStore();
    const runtime = node({
      store,
      namespace: "signal-payload-codec",
      autoStartMaintenance: false,
    });
    const crux = config({ runtime });
    const changed = signal({
      id: "payload.lossless",
      schema: z.object({
        value: z.number(),
        nested: z.object({ count: z.number() }),
      }),
    });
    type Occurrence = SignalOccurrence<
      "payload.lossless",
      { value: number; nested: { count: number } }
    >;
    const listenerSeen = deferred();
    let listenerOccurrence: Occurrence | undefined;
    changed.subscribe((occurrence) => {
      listenerOccurrence = occurrence;
      listenerSeen.resolve();
    });
    const firstReplay = deferred();
    const completed = deferred();
    const flowOccurrences: Occurrence[] = [];
    const consumer = flow(
      "lossless payload consumer",
      { signals: { changed } },
      async (scope) => {
        const occurrence = await scope.waitFor(changed);
        flowOccurrences.push(occurrence);
        if (flowOccurrences.length === 1) {
          firstReplay.resolve();
        }
        await scope.waitFor("payload.release");
        completed.resolve();
      },
    );
    const authored = { value: -0, nested: { count: 1 } };

    try {
      const suspended = await consumer.run({ flowId: "flow_payload_codec" });
      const snapshot = await store.state.getSnapshot(
        suspended.flowId as FlowId,
        { namespace: "signal-payload-codec" },
      );
      const receipt = await changed.publish(authored, {
        idempotencyKey: "lossless-retry",
      });
      authored.nested.count = 99;
      await Promise.all([listenerSeen.promise, firstReplay.promise]);
      await expectWaiterCounts(store, snapshot!.workId, {
        armed: 1,
        total: 2,
      });

      expectPayload(listenerOccurrence!);
      expectPayload(flowOccurrences[0]!);
      expect(() => {
        flowOccurrences[0]!.payload.nested.count = 7;
      }).toThrow(TypeError);

      const runtimeRef: RuntimeTargetRuntimeRef = {};
      const resolved = createRuntime({
        runtime,
        targets: runtimeTargetMap(runtimeRef),
        startMaintenance: false,
      });
      runtimeRef.current = resolved;
      try {
        await resolved.kernel.emitEvent({
          namespace: "signal-payload-codec",
          name: "payload.release",
          payload: null,
        });
        await resolved.dispatcher.nudge();
        await completed.promise;
      } finally {
        resolved.dispose();
      }

      expect(flowOccurrences).toHaveLength(2);
      expectPayload(flowOccurrences[1]!);
      expect(flowOccurrences[1]!.payload).not.toBe(flowOccurrences[0]!.payload);
      await expect(
        changed.publish(
          { value: -0, nested: { count: 1 } },
          { idempotencyKey: "lossless-retry" },
        ),
      ).resolves.toEqual(receipt);
      await expect(
        changed.publish(
          { value: 0, nested: { count: 1 } },
          { idempotencyKey: "lossless-retry" },
        ),
      ).rejects.toMatchObject({ code: "idempotency_conflict" });
      await expectFlowStatus(
        store,
        "signal-payload-codec",
        suspended.flowId,
        "completed",
      );
    } finally {
      crux.dispose();
    }
  });
});

function expectPayload(occurrence: {
  readonly payload: {
    readonly value: number;
    readonly nested: { count: number };
  };
}): void {
  expect(Object.is(occurrence.payload.value, -0)).toBe(true);
  expect(occurrence.payload.nested.count).toBe(1);
  expect(Object.isFrozen(occurrence.payload)).toBe(true);
  expect(Object.isFrozen(occurrence.payload.nested)).toBe(true);
}
