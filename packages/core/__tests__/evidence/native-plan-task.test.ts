import { afterEach, describe, expect, it } from "vitest";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../../src";
import { plan, updatePlan } from "../../src/plan/plans";
import { tasks } from "../../src/plan/tasks";
import { inMemoryRecordStore } from "../../src/storage";
import { resetHooks, updateHooks } from "../../src/runtime/runtime";

describe("Plan and Task native evidence", () => {
  afterEach(() => {
    resetHooks();
    resetObservabilityRuntime();
  });

  it("binds every persisted transition to its exact operation span", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    updateHooks({ records: inMemoryRecordStore() });

    const created = await plan({ title: "Ship" });
    await updatePlan(created.id, { content: "Implement" });
    const work = await tasks({ plan: created });
    await work.add({ id: "implement", label: "Implement" });
    await work.complete("implement", { done: true });
    await work.remove("implement");
    await work.discard("finished");
    await observe.flush();

    for (const name of [
      "plan.create",
      "plan.update",
      "tasklist.create",
      "task.add",
      "task.update",
      "task.remove",
      "tasklist.discard",
    ]) {
      const span = transport.records.find(
        (record) =>
          record.type === "span:start" && record.name === name,
      );
      expect(span?.type).toBe("span:start");
      if (span?.type !== "span:start") continue;
      expect(transport.records).toContainEqual(
        expect.objectContaining({
          type: "edge",
          edgeType: "evidence.for",
          to: { kind: "span", id: span.spanId },
          attributes: expect.objectContaining({
            role: "change",
            evidenceKind: "output",
            producer: { kind: "span", id: span.spanId },
          }),
        }),
      );
    }
  });
});
