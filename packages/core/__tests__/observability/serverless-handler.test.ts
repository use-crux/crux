import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acceptedDeliveryReceipt,
  observabilityDiagnostics,
  resetObservabilityRuntime,
  setObservabilityTransport,
  withObservableInvocation,
  type CruxGraphRecord,
} from "../../src/observability";
import { withNodeObservableInvocation } from "../../src/observability/node";
import { chaosTransport } from "./helpers/chaos-transport";

describe("withObservableInvocation", () => {
  afterEach(() => {
    vi.useRealTimers();
    resetObservabilityRuntime();
  });

  it("flushes a cold-start invocation before returning", async () => {
    const delivered: CruxGraphRecord[] = [];
    setObservabilityTransport(
      {
        send(records) {
          delivered.push(...records);
          return acceptedDeliveryReceipt(records);
        },
      },
      { scheduledDelayMs: 60_000 },
    );

    const handler = withObservableInvocation(async () => {
      const { observe } = await import("../../src/observability");
      observe
        .openRun({ name: "cold start", rootPrimitive: "custom.operation" })
        .end();
      return "ok";
    });

    await expect(handler()).resolves.toBe("ok");
    expect(delivered.length).toBeGreaterThan(0);
    expect(observabilityDiagnostics().queuedRecords).toBe(0);
  });

  it("reuses delivery state across warm invocations without leaking a stale deadline", async () => {
    const delivered: CruxGraphRecord[] = [];
    setObservabilityTransport(
      {
        send(records) {
          delivered.push(...records);
          return acceptedDeliveryReceipt(records);
        },
      },
      { scheduledDelayMs: 60_000 },
    );
    const { observe } = await import("../../src/observability");
    const handler = withObservableInvocation(async (name: string) => {
      observe.openRun({ name, rootPrimitive: "custom.operation" }).end();
      return name;
    });

    await expect(handler("warm-1")).resolves.toBe("warm-1");
    const afterFirst = delivered.length;
    await expect(handler("warm-2")).resolves.toBe("warm-2");

    expect(delivered.length).toBeGreaterThan(afterFirst);
    expect(observabilityDiagnostics().queuedRecords).toBe(0);
  });

  it("binds an independent host lifecycle per concurrent invocation", async () => {
    const delivered: CruxGraphRecord[] = [];
    setObservabilityTransport(
      {
        send(records) {
          delivered.push(...records);
          return acceptedDeliveryReceipt(records);
        },
      },
      { scheduledDelayMs: 60_000 },
    );
    const { observe } = await import("../../src/observability");
    const seenDeadlines: Array<number | undefined> = [];
    const handler = withObservableInvocation(
      async (id: string, delayMs: number, deadlineMs: number) => {
        observe.openRun({ name: id, rootPrimitive: "custom.operation" }).end();
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        seenDeadlines.push(deadlineMs);
        return id;
      },
      (_id, _delayMs, deadlineMs) => ({ deadlineMs }),
    );

    const [fast, slow] = await Promise.all([
      handler("fast", 5, Date.now() + 30_000),
      handler("slow", 20, Date.now() + 60_000),
    ]);

    expect(fast).toBe("fast");
    expect(slow).toBe("slow");
    expect(seenDeadlines).toHaveLength(2);
    expect(observabilityDiagnostics().queuedRecords).toBe(0);
  });

  it("still performs a bounded final flush when the handler throws", async () => {
    const delivered: CruxGraphRecord[] = [];
    setObservabilityTransport(
      {
        send(records) {
          delivered.push(...records);
          return acceptedDeliveryReceipt(records);
        },
      },
      { scheduledDelayMs: 60_000 },
    );
    const { observe } = await import("../../src/observability");
    const handler = withObservableInvocation(async () => {
      observe
        .openRun({ name: "errors out", rootPrimitive: "custom.operation" })
        .end();
      throw new Error("handler failed");
    });

    await expect(handler()).rejects.toThrow("handler failed");
    expect(delivered.length).toBeGreaterThan(0);
  });

  it("reports the drain result through onDrain instead of discarding it", async () => {
    const delivered: CruxGraphRecord[] = [];
    setObservabilityTransport(
      {
        send(records) {
          delivered.push(...records);
          return acceptedDeliveryReceipt(records);
        },
      },
      { scheduledDelayMs: 60_000 },
    );
    const { observe } = await import("../../src/observability");
    const drains: unknown[] = [];
    const handler = withObservableInvocation(
      async () => {
        observe
          .openRun({
            name: "reported drain",
            rootPrimitive: "custom.operation",
          })
          .end();
        return "ok";
      },
      () => ({ onDrain: (result) => drains.push(result) }),
    );

    await expect(handler()).resolves.toBe("ok");
    expect(drains).toEqual([expect.objectContaining({ status: "drained" })]);
  });

  it("warns by default instead of silently discarding an incomplete drain", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const chaos = chaosTransport("reject");
    setObservabilityTransport(chaos.transport, {
      scheduledDelayMs: 0,
      retryDelayMs: 1,
      maxRetryDelayMs: 1,
    });
    const { observe } = await import("../../src/observability");
    const handler = withObservableInvocation(
      async () => {
        observe
          .openRun({
            name: "unreported drain",
            rootPrimitive: "custom.operation",
          })
          .end();
        return "ok";
      },
      () => ({ remainingTimeMs: 5 }),
    );

    const invocation = handler();
    await vi.advanceTimersByTimeAsync(50);
    await expect(invocation).resolves.toBe("ok");

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("drain did not fully complete"),
      expect.any(Object),
    );
  });

  it("preserves the handler error even when the final flush also fails", async () => {
    setObservabilityTransport(
      {
        send() {
          throw new Error("transport is unavailable");
        },
      },
      { scheduledDelayMs: 60_000 },
    );
    const { observe } = await import("../../src/observability");
    const drains: unknown[] = [];
    const handler = withObservableInvocation(
      async () => {
        observe
          .openRun({
            name: "handler throws too",
            rootPrimitive: "custom.operation",
          })
          .end();
        throw new Error("handler failed");
      },
      () => ({ flushTimeoutMs: 5, onDrain: (result) => drains.push(result) }),
    );

    await expect(handler()).rejects.toThrow("handler failed");
    // The drain was still attempted and reported, even though it could not
    // fully complete before the handler's own error takes priority.
    expect(drains).toHaveLength(1);
  });

  it("reports a synthetic failed drain result instead of masking the handler result when flush itself throws", async () => {
    const { observe } = await import("../../src/observability");
    setObservabilityTransport(
      { send: acceptedDeliveryReceipt },
      { scheduledDelayMs: 60_000 },
    );
    const flushSpy = vi
      .spyOn(observe, "flush")
      .mockRejectedValueOnce(new Error("flush exploded"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const drains: unknown[] = [];
    const handler = withObservableInvocation(
      async () => {
        observe
          .openRun({ name: "flush throws", rootPrimitive: "custom.operation" })
          .end();
        return "ok";
      },
      () => ({ onDrain: (result) => drains.push(result) }),
    );

    await expect(handler()).resolves.toBe("ok");
    expect(drains).toEqual([expect.objectContaining({ status: "failed" })]);
    expect(errorSpy).toHaveBeenCalled();
    flushSpy.mockRestore();
  });

  it("does not let a throwing onDrain reporter affect the handler result", async () => {
    const { observe } = await import("../../src/observability");
    setObservabilityTransport(
      { send: acceptedDeliveryReceipt },
      { scheduledDelayMs: 60_000 },
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = withObservableInvocation(
      async () => {
        observe
          .openRun({
            name: "reporter throws",
            rootPrimitive: "custom.operation",
          })
          .end();
        return "ok";
      },
      () => ({
        onDrain: () => {
          throw new Error("reporter is broken");
        },
      }),
    );

    await expect(handler()).resolves.toBe("ok");
    expect(errorSpy).toHaveBeenCalled();
  });

  it("contains a rejected async onDrain reporter without changing the handler result", async () => {
    const { observe } = await import("../../src/observability");
    setObservabilityTransport(
      { send: acceptedDeliveryReceipt },
      { scheduledDelayMs: 60_000 },
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let rejectReporter!: (error: Error) => void;
    const reporter = new Promise<void>((_resolve, reject) => {
      rejectReporter = reject;
    });
    const handler = withObservableInvocation(
      async () => {
        observe
          .openRun({
            name: "async reporter rejects",
            rootPrimitive: "custom.operation",
          })
          .end();
        return "ok";
      },
      () => ({
        onDrain: () => reporter,
      }),
    );

    await expect(settlesBeforeReporter(handler())).resolves.toBe("ok");
    rejectReporter(new Error("async serverless reporter failed"));
    await Promise.resolve();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("onDrain reporter rejected"),
      expect.objectContaining({ message: "async serverless reporter failed" }),
    );
  });

  it("contains a rejected pending onDrain reporter without masking the handler error", async () => {
    setObservabilityTransport(
      { send: acceptedDeliveryReceipt },
      { scheduledDelayMs: 60_000 },
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let rejectReporter!: (error: Error) => void;
    const reporter = new Promise<void>((_resolve, reject) => {
      rejectReporter = reject;
    });
    const handlerError = new Error("handler failed first");
    const handler = withObservableInvocation(
      async () => {
        throw handlerError;
      },
      () => ({ onDrain: () => reporter }),
    );

    await expect(settlesBeforeReporter(handler())).rejects.toBe(handlerError);
    rejectReporter(new Error("async serverless reporter failed after handler"));
    await Promise.resolve();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("onDrain reporter rejected"),
      expect.objectContaining({
        message: "async serverless reporter failed after handler",
      }),
    );
  });

  it("stops flushing once the derived deadline is exhausted", async () => {
    vi.useFakeTimers();
    const chaos = chaosTransport("reject");
    setObservabilityTransport(chaos.transport, {
      scheduledDelayMs: 0,
      retryDelayMs: 1,
      maxRetryDelayMs: 1,
    });
    const { observe } = await import("../../src/observability");
    const handler = withObservableInvocation(
      async () => {
        observe
          .openRun({
            name: "deadline exhausted",
            rootPrimitive: "custom.operation",
          })
          .end();
        return "ok";
      },
      () => ({ remainingTimeMs: 5 }),
    );

    const invocation = handler();
    await vi.advanceTimersByTimeAsync(50);
    await expect(invocation).resolves.toBe("ok");
    expect(observabilityDiagnostics().queuedRecords).toBeGreaterThan(0);
  });

  it("snapshots the deadline once at invocation start instead of extending it on every read", async () => {
    vi.useFakeTimers();
    const chaos = chaosTransport("reject");
    setObservabilityTransport(chaos.transport, {
      scheduledDelayMs: 0,
      retryDelayMs: 1,
      maxRetryDelayMs: 1,
    });
    const { observe } = await import("../../src/observability");
    const handler = withObservableInvocation(
      async () => {
        observe
          .openRun({
            name: "moving deadline",
            rootPrimitive: "custom.operation",
          })
          .end();
        // Handler work that consumes most of the invocation's budget before
        // the wrapper's final flush ever reads the deadline.
        await new Promise((resolve) => setTimeout(resolve, 15));
        return "ok";
      },
      () => ({ remainingTimeMs: 20 }),
    );

    let settled = false;
    const invocation = handler().then((value) => {
      settled = true;
      return value;
    });

    await vi.advanceTimersByTimeAsync(15);
    expect(settled).toBe(false);

    // If the deadline were re-derived from `Date.now() + remainingTimeMs` on
    // every read instead of snapshotted once, the flush budget would restart
    // at a fresh 20ms here (instead of the ~5ms actually left) and the
    // invocation would still be draining well past this point.
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toBe(true);
    await expect(invocation).resolves.toBe("ok");
    expect(observabilityDiagnostics().queuedRecords).toBeGreaterThan(0);
  });

  it("accepts an explicit remaining-time budget instead of an absolute deadline", async () => {
    const delivered: CruxGraphRecord[] = [];
    setObservabilityTransport(
      {
        send(records) {
          delivered.push(...records);
          return acceptedDeliveryReceipt(records);
        },
      },
      { scheduledDelayMs: 60_000 },
    );
    const { observe } = await import("../../src/observability");
    const handler = withObservableInvocation(
      async () => {
        observe
          .openRun({
            name: "remaining time",
            rootPrimitive: "custom.operation",
          })
          .end();
        return "ok";
      },
      () => ({ remainingTimeMs: 30_000 }),
    );

    await expect(handler()).resolves.toBe("ok");
    expect(delivered.length).toBeGreaterThan(0);
  });
});

async function settlesBeforeReporter<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("host boundary awaited advisory reporter")),
          1_000,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

describe("withNodeObservableInvocation", () => {
  afterEach(() => {
    resetObservabilityRuntime();
  });

  it("derives the deadline from context.getRemainingTimeInMillis()", async () => {
    const delivered: CruxGraphRecord[] = [];
    setObservabilityTransport(
      {
        send(records) {
          delivered.push(...records);
          return acceptedDeliveryReceipt(records);
        },
      },
      { scheduledDelayMs: 60_000 },
    );
    const { observe } = await import("../../src/observability");
    const handler = withNodeObservableInvocation(
      async (event: { documentId: string }) => {
        observe
          .openRun({
            name: "lambda invocation",
            rootPrimitive: "custom.operation",
          })
          .end();
        return event.documentId;
      },
    );

    await expect(
      handler(
        { documentId: "doc_1" },
        { getRemainingTimeInMillis: () => 30_000 },
      ),
    ).resolves.toBe("doc_1");
    expect(delivered.length).toBeGreaterThan(0);
  });

  it("still flushes when the context has no getRemainingTimeInMillis()", async () => {
    const delivered: CruxGraphRecord[] = [];
    setObservabilityTransport(
      {
        send(records) {
          delivered.push(...records);
          return acceptedDeliveryReceipt(records);
        },
      },
      { scheduledDelayMs: 60_000 },
    );
    const { observe } = await import("../../src/observability");
    const handler = withNodeObservableInvocation(
      async (event: { documentId: string }) => {
        observe
          .openRun({
            name: "lambda invocation no context",
            rootPrimitive: "custom.operation",
          })
          .end();
        return event.documentId;
      },
    );

    await expect(handler({ documentId: "doc_2" }, {})).resolves.toBe("doc_2");
    expect(delivered.length).toBeGreaterThan(0);
  });
});
