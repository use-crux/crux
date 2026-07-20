import { afterEach, describe, expect, it } from "vitest";
import { config, flow, inMemoryRecordStore } from "@use-crux/core";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "@use-crux/core/observability";
import "./result-correlation-edge.cases";

afterEach(() => {
  resetObservabilityRuntime();
});

describe("flow result correlation", () => {
  it("points a completed record-store result at its exact flow.run span", async () => {
    const crux = config({
      persistence: { records: inMemoryRecordStore() },
    });
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    try {
      const result = await flow("correlated completed flow", async () => {
        return { published: true };
      }).run({ flowId: "flow-result-correlation-completed" });
      await observe.flush();

      const owner = transport.records.find(
        (record) =>
          record.type === "span:start" &&
          record.primitive === "flow.run" &&
          record.attributes.flowId === result.flowId,
      );

      expect(result.status).toBe("completed");
      expect(owner).toBeDefined();
      expect(result._meta).toEqual({
        traceId: owner?.traceId,
        spanId: owner?.spanId,
      });
    } finally {
      crux.dispose();
    }
  });

  it("points a suspended result at the invocation that reached suspension", async () => {
    const crux = config({
      persistence: { records: inMemoryRecordStore() },
    });
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    try {
      const result = await flow("correlated suspended flow", async (scope) => {
        await scope.suspend("approval");
        return "published";
      }).run({ flowId: "flow-result-correlation-suspended" });
      await observe.flush();

      const owner = transport.records.find(
        (record) =>
          record.type === "span:start" &&
          record.primitive === "flow.run" &&
          record.attributes.flowId === result.flowId,
      );
      const end = transport.records.find(
        (record) =>
          record.type === "span:end" && record.spanId === owner?.spanId,
      );

      expect(result.status).toBe("suspended");
      expect(result._meta).toEqual({
        traceId: owner?.traceId,
        spanId: owner?.spanId,
      });
      expect(end).toMatchObject({ status: "suspended" });
    } finally {
      crux.dispose();
    }
  });

  it("keeps the trace and points a resumed result at its fresh invocation", async () => {
    const crux = config({
      persistence: { records: inMemoryRecordStore() },
    });
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const review = flow("correlated resumed flow", async (scope) => {
      await scope.suspend("approval");
      return "published";
    });

    try {
      const suspended = await review.run({
        flowId: "flow-result-correlation-resumed",
      });
      await review.signal(suspended.flowId, "approval", undefined, {
        resume: false,
      });
      const resumed = await review.resume(suspended.flowId);
      await observe.flush();

      const owners = transport.records.filter(
        (record) =>
          record.type === "span:start" &&
          record.primitive === "flow.run" &&
          record.attributes.flowId === suspended.flowId,
      );

      expect(suspended.status).toBe("suspended");
      expect(resumed.status).toBe("completed");
      expect(owners).toHaveLength(2);
      expect(suspended._meta).toEqual({
        traceId: owners[0]?.traceId,
        spanId: owners[0]?.spanId,
      });
      expect(resumed._meta).toEqual({
        traceId: owners[1]?.traceId,
        spanId: owners[1]?.spanId,
      });
      expect(resumed._meta.traceId).toBe(suspended._meta.traceId);
      expect(resumed._meta.spanId).not.toBe(suspended._meta.spanId);
      expect(resumed._meta).not.toHaveProperty("segmentId");
    } finally {
      crux.dispose();
    }
  });

  it("points a cancelled result at the invocation that cancelled", async () => {
    const crux = config({
      persistence: { records: inMemoryRecordStore() },
    });
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    try {
      const result = await flow("correlated cancelled flow", async (scope) => {
        scope.cancel("review rejected");
      }).run({ flowId: "flow-result-correlation-cancelled" });
      await observe.flush();

      const owner = transport.records.find(
        (record) =>
          record.type === "span:start" &&
          record.primitive === "flow.run" &&
          record.attributes.flowId === result.flowId,
      );

      expect(result.status).toBe("cancelled");
      expect(result._meta).toEqual({
        traceId: owner?.traceId,
        spanId: owner?.spanId,
      });
    } finally {
      crux.dispose();
    }
  });

  it("points an expired result at the invocation that observed expiry", async () => {
    const crux = config({
      persistence: { records: inMemoryRecordStore() },
    });
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const review = flow("correlated expired flow", async (scope) => {
      await scope.suspend("approval", { timeout: "0ms" });
      return "published";
    });

    try {
      const suspended = await review.run({
        flowId: "flow-result-correlation-expired",
      });
      await review.signal(suspended.flowId, "approval", undefined, {
        resume: false,
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const expired = await review.resume(suspended.flowId);
      await observe.flush();

      const owners = transport.records.filter(
        (record) =>
          record.type === "span:start" &&
          record.primitive === "flow.run" &&
          record.attributes.flowId === suspended.flowId,
      );

      expect(expired.status).toBe("expired");
      expect(owners).toHaveLength(2);
      expect(expired._meta).toEqual({
        traceId: owners[1]?.traceId,
        spanId: owners[1]?.spanId,
      });
    } finally {
      crux.dispose();
    }
  });
});
