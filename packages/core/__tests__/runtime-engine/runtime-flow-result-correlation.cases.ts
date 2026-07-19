import { afterEach, describe, expect, it } from "vitest";
import { config, flow } from "@use-crux/core";
import { node, type FlowId, type WorkId } from "@use-crux/core/runtime";
import { createTestRuntime } from "@use-crux/core/runtime/testing";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "@use-crux/core/observability";

afterEach(() => {
  resetObservabilityRuntime();
});

describe("runtime flow result correlation", () => {
  it("uses the current resume span and strips stale cached result metadata", async () => {
    const runtime = node({
      namespace: "runtime-result-correlation",
      autoStartMaintenance: false,
    });
    const crux = config({ runtime });
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const review = flow("runtime correlated result", async (scope) => {
      const storedResult = await scope.step("stored-result", () => ({
        status: "completed" as const,
        output: {
          provider: { _meta: { responseId: "original-response" } },
        },
        flowId: "legacy-child",
      }));
      await scope.suspend("approval");
      return storedResult;
    });

    try {
      const suspended = await review.run({
        flowId: "runtime-result-correlation-flow",
      });
      const snapshot = await runtime.store.state.getSnapshot(
        suspended.flowId as FlowId,
        { namespace: runtime.namespace },
      );
      expect(snapshot).not.toBeNull();
      if (!snapshot) throw new Error("Expected suspended runtime snapshot.");
      await runtime.store.state.putSnapshot({
        ...snapshot,
        completedSteps: {
          ...snapshot.completedSteps,
          "stored-result": {
            ...snapshot.completedSteps["stored-result"],
            output: {
              provider: {
                _meta: {
                  traceId: "legacy-trace",
                  spanId: "legacy-span",
                  responseId: "historical-response",
                },
              },
            },
          },
        },
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
      if (resumed.status !== "completed") {
        throw new Error("Expected completed runtime flow result.");
      }
      expect(resumed.output).toEqual({
        status: "completed",
        output: {
          provider: { _meta: { responseId: "historical-response" } },
        },
        flowId: "legacy-child",
      });
    } finally {
      crux.dispose();
    }
  });

  it("returns an observed expiry and completes Runtime work on due resume", async () => {
    const runtime = node({
      namespace: "runtime-result-expiry",
      autoStartMaintenance: false,
    });
    const crux = config({ runtime });
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    let expiredCalls = 0;
    const review = flow("runtime correlated expiry", async (scope) => {
      await scope.suspend("approval", {
        timeout: "0ms",
        onExpired: () => {
          expiredCalls += 1;
        },
      });
      return "published";
    });

    try {
      const suspended = await review.run({
        flowId: "runtime-result-expiry-flow",
      });
      const expired = await review.resume(suspended.flowId);
      await observe.flush();
      const snapshot = await runtime.store.state.getSnapshot(
        suspended.flowId as FlowId,
        { namespace: runtime.namespace },
      );
      const work = await runtime.store.state.getWork(
        snapshot?.workId as WorkId,
        { namespace: runtime.namespace },
      );
      const owners = transport.records.filter(
        (record) =>
          record.type === "span:start" &&
          record.primitive === "flow.run" &&
          record.attributes.flowId === suspended.flowId,
      );

      expect(expired.status).toBe("expired");
      expect(expired._meta).toEqual({
        traceId: owners[1]?.traceId,
        spanId: owners[1]?.spanId,
      });
      expect(expired._meta.traceId).toBe(suspended._meta.traceId);
      expect(expired._meta.spanId).not.toBe(suspended._meta.spanId);
      expect(expiredCalls).toBe(1);
      expect(snapshot?.status).toBe("expired");
      expect(work?.status).toBe("completed");
      await expect(review.resume(suspended.flowId)).rejects.toThrow(
        "could not resume",
      );
    } finally {
      crux.dispose();
    }
  });

  it("lets an already delivered signal win over a due timeout", async () => {
    const runtime = node({
      namespace: "runtime-result-signal-wins",
      autoStartMaintenance: false,
    });
    const crux = config({ runtime });
    let expiredCalls = 0;
    const review = flow("runtime signal wins", async (scope) => {
      const approval = await scope.suspend<{ approved: boolean }>("approval", {
        timeout: "0ms",
        onExpired: () => {
          expiredCalls += 1;
        },
      });
      return approval;
    });

    try {
      const suspended = await review.run({
        flowId: "runtime-result-signal-wins-flow",
      });
      await review.signal(
        suspended.flowId,
        "approval",
        { approved: true },
        { resume: false },
      );
      const resumed = await review.resume(suspended.flowId);
      const snapshot = await runtime.store.state.getSnapshot(
        suspended.flowId as FlowId,
        { namespace: runtime.namespace },
      );

      expect(resumed).toMatchObject({
        status: "completed",
        output: { approved: true },
      });
      expect(snapshot?.status).toBe("completed");
      expect(expiredCalls).toBe(0);
    } finally {
      crux.dispose();
    }
  });

  it("persists background timer expiry while completing scheduler work", async () => {
    let expiredCalls = 0;
    const review = flow("runtime background expiry", async (scope) => {
      await scope.suspend("approval", {
        timeout: "1h",
        onExpired: () => {
          expiredCalls += 1;
        },
      });
      return "published";
    });
    const testRuntime = createTestRuntime({
      targets: [review],
      epoch: new Date("2026-07-18T00:00:00.000Z"),
    });

    try {
      const suspended = await review.run({
        flowId: "runtime-background-expiry-flow",
      });
      await testRuntime.clock.advance("1h");
      const snapshot = await testRuntime.store.state.getSnapshot(
        suspended.flowId as FlowId,
        { namespace: testRuntime.runtime.namespace },
      );
      const work = await testRuntime.store.state.getWork(
        snapshot?.workId as WorkId,
        { namespace: testRuntime.runtime.namespace },
      );

      expect(suspended.status).toBe("suspended");
      expect(snapshot?.status).toBe("expired");
      expect(work?.status).toBe("completed");
      expect(expiredCalls).toBe(1);
    } finally {
      testRuntime.dispose();
    }
  });
});
