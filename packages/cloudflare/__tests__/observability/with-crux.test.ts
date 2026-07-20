import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defer } from "@use-crux/core";
import { observe } from "@use-crux/core/observability";
import { withCrux } from "../../src";
import { deliveredRecords, resetFixture } from "./fixtures/worker";

describe("Workers withCrux lifecycle", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetFixture({ transportDelayMs: 25 });
  });

  it("returns the exact response while waitUntil owns deferred work and the final drain", async () => {
    let releaseDeferred!: () => void;
    const deferredGate = new Promise<void>((resolve) => {
      releaseDeferred = resolve;
    });
    let deferredCompleted = false;
    const handler = withCrux(
      async (_request: Request, _ctx: ExecutionContext) => {
        const run = observe.openRun({
          name: "workers-with-crux",
          rootPrimitive: "run",
        });
        run.end();
        defer(async () => {
          await deferredGate;
          deferredCompleted = true;
        });
        return Response.json({ ok: true });
      },
      { context: (_request, ctx) => ctx },
    );
    const ctx = createExecutionContext();

    const response = await handler(new Request("https://fixture.test"), ctx);

    expect(response).toBeInstanceOf(Response);
    expect(await response.json()).toEqual({ ok: true });
    expect(deferredCompleted).toBe(false);
    expect(deliveredRecords()).toHaveLength(0);

    releaseDeferred();
    await waitOnExecutionContext(ctx);
    expect(deferredCompleted).toBe(true);
    expect(deliveredRecords()).toContainEqual(
      expect.objectContaining({ type: "run:start", name: "workers-with-crux" }),
    );
  });

  it("hands Workers one retained task whose drain report follows deferred telemetry", async () => {
    resetFixture();
    const retained: Promise<unknown>[] = [];
    const onDrain = vi.fn(() => {
      expect(deliveredRecords()).toContainEqual(
        expect.objectContaining({ type: "span:end", primitive: "defer.run" }),
      );
    });
    const context = {
      waitUntil(promise: Promise<unknown>) {
        retained.push(promise);
      },
    };
    const handler = withCrux(
      async () => {
        defer(() => undefined);
        return "response";
      },
      {
        context: () => context,
        invocation: () => ({ onDrain }),
      },
    );

    await expect(handler()).resolves.toBe("response");
    expect(retained).toHaveLength(1);
    await retained[0];
    expect(onDrain).toHaveBeenCalledOnce();
  });

  it("rethrows the original handler error and skips inline work for the failed scope", async () => {
    const original = new Error("workers handler failed");
    let deferredCompleted = false;
    const handler = withCrux(
      async (_ctx: ExecutionContext) => {
        observe
          .openRun({ name: "workers-with-crux-error", rootPrimitive: "run" })
          .end();
        defer(() => {
          deferredCompleted = true;
        });
        throw original;
      },
      { context: (ctx) => ctx },
    );
    const ctx = createExecutionContext();

    await expect(handler(ctx)).rejects.toBe(original);
    await waitOnExecutionContext(ctx);

    expect(deferredCompleted).toBe(false);
    expect(deliveredRecords()).toContainEqual(
      expect.objectContaining({
        type: "run:start",
        name: "workers-with-crux-error",
      }),
    );
  });

  it("preserves the handler result and reports a structured failure when the drain throws", async () => {
    const flushError = new Error("exporter failed");
    vi.spyOn(observe, "flush").mockRejectedValue(flushError);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onDrain = vi.fn();
    const handler = withCrux(
      async (_ctx: ExecutionContext) => "exact-result" as const,
      {
        context: (ctx) => ctx,
        invocation: () => ({ onDrain }),
      },
    );
    const ctx = createExecutionContext();

    await expect(handler(ctx)).resolves.toBe("exact-result");
    await waitOnExecutionContext(ctx);

    expect(onDrain).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", deadlineExceeded: false }),
    );
  });

  it("contains a throwing drain reporter without changing the result or rejecting waitUntil", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const handler = withCrux(
      async (_ctx: ExecutionContext) => ({ ok: true }) as const,
      {
        context: (ctx) => ctx,
        invocation: () => ({
          onDrain: () => {
            throw new Error("reporter failed");
          },
        }),
      },
    );
    const ctx = createExecutionContext();

    await expect(handler(ctx)).resolves.toEqual({ ok: true });
    await expect(waitOnExecutionContext(ctx)).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("onDrain reporter threw"),
      expect.objectContaining({ message: "reporter failed" }),
    );
  });

  it("contains a rejected async drain reporter without changing the result or rejecting waitUntil", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    let rejectReporter!: (error: Error) => void;
    const reporter = new Promise<void>((_resolve, reject) => {
      rejectReporter = reject;
    });
    const handler = withCrux(
      async (_ctx: ExecutionContext) => "workers-result" as const,
      {
        context: (ctx) => ctx,
        invocation: () => ({
          onDrain: () => reporter,
        }),
      },
    );
    const ctx = createExecutionContext();

    await expect(handler(ctx)).resolves.toBe("workers-result");
    await expect(
      settlesBeforeReporter(waitOnExecutionContext(ctx)),
    ).resolves.toBeUndefined();
    rejectReporter(new Error("async workers reporter failed"));
    await Promise.resolve();

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("onDrain reporter rejected"),
      expect.objectContaining({ message: "async workers reporter failed" }),
    );
  });

  it("reports a truthful partial drain when the host budget expires", async () => {
    vi.spyOn(observe, "flush").mockResolvedValue({
      status: "deadline",
      delivered: 0,
      rejected: 0,
      remaining: 1,
      deadlineExceeded: true,
    });
    const onDrain = vi.fn();
    const handler = withCrux(
      async (_ctx: ExecutionContext) => {
        observe
          .openRun({ name: "workers-with-crux-deadline", rootPrimitive: "run" })
          .end();
        return "response";
      },
      {
        context: (ctx) => ctx,
        invocation: () => ({ flushTimeoutMs: 5, onDrain }),
      },
    );
    const ctx = createExecutionContext();

    await expect(handler(ctx)).resolves.toBe("response");
    await waitOnExecutionContext(ctx);

    expect(onDrain).toHaveBeenCalledWith(
      expect.objectContaining({ status: "deadline", deadlineExceeded: true }),
    );
  });

  it("keeps concurrent deferred callbacks attached to their own request run", async () => {
    resetFixture();
    const handler = withCrux(
      (requestId: string, _ctx: ExecutionContext) => {
        const run = observe.openRun({
          name: `workers-concurrent-${requestId}`,
          rootPrimitive: "run",
        });
        run.withContext(() => {
          defer(() => {
            observe
              .openSpan({
                name: `deferred-${requestId}`,
                primitive: "defer.run",
              })
              .end();
            run.end();
          });
        });
        return Response.json({ requestId });
      },
      { context: (_requestId, ctx) => ctx },
    );
    const requestIds = Array.from(
      { length: 6 },
      (_, index) => `request-${index}`,
    );
    const contexts = requestIds.map(() => createExecutionContext());

    const responses = await Promise.all(
      requestIds.map((requestId, index) =>
        handler(requestId, contexts[index]!),
      ),
    );
    expect(
      await Promise.all(responses.map((response) => response.json())),
    ).toEqual(requestIds.map((requestId) => ({ requestId })));
    await Promise.all(contexts.map((ctx) => waitOnExecutionContext(ctx)));

    const records = deliveredRecords();
    for (const requestId of requestIds) {
      const runStart = records.find(
        (record) =>
          record.type === "run:start" &&
          record.name === `workers-concurrent-${requestId}`,
      );
      expect(runStart).toBeDefined();
      expect(records).toContainEqual(
        expect.objectContaining({
          type: "span:start",
          name: `deferred-${requestId}`,
          runId: runStart?.runId,
        }),
      );
    }
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
