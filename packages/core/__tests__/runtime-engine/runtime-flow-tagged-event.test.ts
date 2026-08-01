import { afterEach, describe, expect, it } from "vitest";
import { config, flow } from "@use-crux/core";
import { createRuntime, node, type FlowId } from "@use-crux/core/runtime";
import { z } from "zod";
import { runtimeTargetMap } from "../../src/runtime/api/target-registry";
import { resetHooks } from "../../src/runtime/runtime";

afterEach(() => {
  resetHooks();
});

describe("runtime Flow event compatibility", () => {
  it("treats an event definition with an unrelated _tag as an event", async () => {
    const runtime = node({
      namespace: "tagged-event",
      autoStartMaintenance: false,
    });
    const crux = config({ runtime });
    const event = {
      name: "document.tagged",
      schema: z.object({ version: z.number() }),
      _tag: "DomainEvent",
    } as const;
    const seen: number[] = [];
    const consumer = flow("tagged ordinary event", async (scope) => {
      const payload = await scope.waitFor(event);
      seen.push(payload.version);
    });
    const runtimeRef = {};
    const resolved = createRuntime({
      runtime,
      targets: runtimeTargetMap(runtimeRef),
      startMaintenance: false,
    });
    Object.assign(runtimeRef, { current: resolved });

    try {
      const suspended = await consumer.run({ flowId: "flow_tagged_event" });
      await resolved.kernel.emitEvent({
        namespace: "tagged-event",
        name: event.name,
        payload: { version: 7 },
      });
      await resolved.dispatcher.nudge();

      expect(seen).toEqual([7]);
      await expect(
        runtime.store.state.getSnapshot(suspended.flowId as FlowId, {
          namespace: "tagged-event",
        }),
      ).resolves.toMatchObject({ status: "completed" });
    } finally {
      resolved.dispose();
      crux.dispose();
    }
  });
});
