import { describe, expect, it } from "vitest";
import { config, flow } from "@use-crux/core";
import {
  durableTask,
  node,
  type EventCursor,
  type FlowId,
  type TimerId,
  type WorkId,
} from "@use-crux/core/runtime";

describe("runtime flow persistence sanitization", () => {
  it("sanitizes Runtime snapshot input without mutating live input", async () => {
    const runtime = node({
      namespace: "runtime-sanitized-input",
      autoStartMaintenance: false,
    });
    const crux = config({ runtime });
    const liveInput = {
      nested: [
        {
          _meta: {
            traceId: "input-trace",
            spanId: "input-span",
            responseId: "input-response",
          },
        },
      ],
    };
    const review = flow("runtime sanitized input", async (scope) => {
      await scope.suspend("approval");
      return "published";
    });

    try {
      const suspended = await review.run(liveInput, {
        flowId: "runtime-sanitized-input-flow",
      });
      const snapshot = await runtime.store.state.getSnapshot(
        suspended.flowId as FlowId,
        { namespace: runtime.namespace },
      );

      expect(snapshot?.input).toEqual({
        nested: [{ _meta: { responseId: "input-response" } }],
      });
      expect(liveInput.nested[0]?._meta).toMatchObject({
        traceId: "input-trace",
        spanId: "input-span",
      });
    } finally {
      crux.dispose();
    }
  });

  it("sanitizes Runtime signal event and delivered-suspend payloads", async () => {
    const runtime = node({
      namespace: "runtime-sanitized-signal",
      autoStartMaintenance: false,
    });
    const crux = config({ runtime });
    const review = flow("runtime sanitized signal", async (scope) => {
      await scope.suspend("approval");
      return "published";
    });
    const livePayload = {
      result: {
        _meta: {
          traceId: "signal-trace",
          spanId: "signal-span",
          responseId: "signal-response",
        },
      },
    };

    try {
      const suspended = await review.run({
        flowId: "runtime-sanitized-signal-flow",
      });
      await review.signal(suspended.flowId, "approval", livePayload, {
        resume: false,
      });
      const snapshot = await runtime.store.state.getSnapshot(
        suspended.flowId as FlowId,
        { namespace: runtime.namespace },
      );
      const delivered = Object.values(snapshot?.deliveredSuspends ?? {})[0];
      const pending = snapshot?.pendingSuspends[0]?.delivered;
      const eventLog = await runtime.store.events.read({
        namespace: runtime.namespace,
      });
      const event = eventLog.events.find((candidate) =>
        candidate.name.endsWith(":approval"),
      );

      expect(event?.payload).toEqual({
        result: { _meta: { responseId: "signal-response" } },
      });
      expect(delivered?.payload).toEqual({
        result: { _meta: { responseId: "signal-response" } },
      });
      expect(pending?.payload).toEqual(delivered?.payload);
      expect(livePayload.result._meta).toMatchObject({
        traceId: "signal-trace",
        spanId: "signal-span",
      });
    } finally {
      crux.dispose();
    }
  });

  it("sanitizes legacy delivered payloads before replay and persistence", async () => {
    const runtime = node({
      namespace: "runtime-sanitized-delivered-replay",
      autoStartMaintenance: false,
    });
    const crux = config({ runtime });
    const review = flow("runtime sanitized delivered replay", async (scope) => {
      return await scope.suspend("approval");
    });

    try {
      const suspended = await review.run({
        flowId: "runtime-sanitized-delivered-replay-flow",
      });
      const snapshot = await runtime.store.state.getSnapshot(
        suspended.flowId as FlowId,
        { namespace: runtime.namespace },
      );
      const pending = snapshot?.pendingSuspends[0];
      if (!snapshot || !pending) {
        throw new Error("Expected a pending Runtime suspension.");
      }
      const deliveryKey = pending.deliveryKey ?? pending.label;
      const delivered = {
        eventId: "event_legacy" as EventCursor,
        payload: {
          nested: {
            _meta: {
              traceId: "legacy-trace",
              spanId: "legacy-span",
              model: "provider-model",
            },
          },
        },
      };
      await runtime.store.state.putSnapshot({
        ...snapshot,
        pendingSuspends: [{ ...pending, delivered }],
        deliveredSuspends: { [deliveryKey]: delivered },
      });

      const resumed = await review.resume(suspended.flowId);
      const completedSnapshot = await runtime.store.state.getSnapshot(
        suspended.flowId as FlowId,
        { namespace: runtime.namespace },
      );
      const expectedPayload = {
        nested: { _meta: { model: "provider-model" } },
      };

      expect(resumed).toMatchObject({
        status: "completed",
        output: expectedPayload,
      });
      expect(
        completedSnapshot?.deliveredSuspends?.[deliveryKey]?.payload,
      ).toEqual(expectedPayload);
    } finally {
      crux.dispose();
    }
  });

  it("sanitizes flow.defer and flow.after inputs before durable flush", async () => {
    const runtime = node({
      namespace: "runtime-sanitized-scheduled-work",
      autoStartMaintenance: false,
    });
    const crux = config({ runtime });
    const task = durableTask("sanitized scheduled task", {
      run: async (_input: unknown) => undefined,
    });
    const deferredInput = observedInput("defer");
    const delayedInput = observedInput("after");
    const review = flow("runtime sanitized scheduled work", async (scope) => {
      await scope.defer(task, deferredInput);
      await scope.after(task, "1h", delayedInput);
      await scope.suspend("approval");
      return "published";
    });

    try {
      const suspended = await review.run({
        flowId: "runtime-sanitized-scheduled-work-flow",
      });
      const snapshot = await runtime.store.state.getSnapshot(
        suspended.flowId as FlowId,
        { namespace: runtime.namespace },
      );
      const deferredWork = await runtime.store.state.getWork(
        snapshot?.scheduledWork?.["defer:1"]?.workId as WorkId,
        { namespace: runtime.namespace },
      );
      const delayedTimer = await runtime.store.timers.get(
        snapshot?.scheduledWork?.["after:2"]?.timerId as TimerId,
      );

      expect(deferredWork?.work.kind).toBe("task.run");
      expect(delayedTimer?.work.kind).toBe("task.run");
      if (deferredWork?.work.kind !== "task.run") {
        throw new Error("Expected deferred task work.");
      }
      if (delayedTimer?.work.kind !== "task.run") {
        throw new Error("Expected delayed task work.");
      }
      expect(deferredWork.work.input).toEqual(sanitizedInput("defer"));
      expect(delayedTimer.work.input).toEqual(sanitizedInput("after"));
      expect(deferredInput._meta).toHaveProperty("traceId", "defer-trace");
      expect(delayedInput._meta).toHaveProperty("spanId", "after-span");
    } finally {
      crux.dispose();
    }
  });
});

function observedInput(label: string) {
  return {
    _meta: {
      traceId: `${label}-trace`,
      spanId: `${label}-span`,
      responseId: `${label}-response`,
    },
  };
}

function sanitizedInput(label: string) {
  return { _meta: { responseId: `${label}-response` } };
}
