import { afterEach, describe, expect, it } from "vitest";
import { config, flow, inMemoryRecordStore } from "@use-crux/core";
import {
  __setAlsForTesting,
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "@use-crux/core/observability";

afterEach(() => {
  __setAlsForTesting("auto");
  resetObservabilityRuntime();
});

describe("flow result correlation context edges", () => {
  it("does not copy a nested child flow or step span onto the parent result", async () => {
    const crux = config({
      storage: { records: inMemoryRecordStore() },
    });
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const child = flow("correlated nested child", async () => "child output");
    let childResult: Awaited<ReturnType<typeof child.run>> | undefined;
    const parent = flow("correlated nested parent", async (scope) => {
      childResult = await scope.step("run child", () =>
        child.run({ flowId: "flow-result-correlation-child" }),
      );
      return "parent output";
    });

    try {
      const parentResult = await parent.run({
        flowId: "flow-result-correlation-parent",
      });
      await observe.flush();

      const parentOwner = transport.records.find(
        (record) =>
          record.type === "span:start" &&
          record.primitive === "flow.run" &&
          record.attributes.flowId === parentResult.flowId,
      );
      const childOwner = transport.records.find(
        (record) =>
          record.type === "span:start" &&
          record.primitive === "flow.run" &&
          record.attributes.flowId === childResult?.flowId,
      );
      const step = transport.records.find(
        (record) =>
          record.type === "span:start" && record.primitive === "flow.step",
      );

      expect(parentResult._meta).toEqual({
        traceId: parentOwner?.traceId,
        spanId: parentOwner?.spanId,
      });
      expect(childResult?._meta).toEqual({
        traceId: childOwner?.traceId,
        spanId: childOwner?.spanId,
      });
      expect(parentResult._meta.spanId).not.toBe(childResult?._meta.spanId);
      expect(parentResult._meta.spanId).not.toBe(step?.spanId);
    } finally {
      crux.dispose();
    }
  });

  it("uses explicit flow span identity without AsyncLocalStorage", async () => {
    __setAlsForTesting(null);
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    const result = await flow("correlated no ALS flow", async () => {
      return "completed";
    }).run({ flowId: "flow-result-correlation-no-als" });
    await observe.flush();

    const owner = transport.records.find(
      (record) =>
        record.type === "span:start" &&
        record.primitive === "flow.run" &&
        record.attributes.flowId === result.flowId,
    );
    expect(result._meta).toEqual({
      traceId: owner?.traceId,
      spanId: owner?.spanId,
    });
  });
});
