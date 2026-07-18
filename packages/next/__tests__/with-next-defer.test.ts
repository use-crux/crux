import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { defer, type CruxDeferError } from "@use-crux/core";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "@use-crux/core/observability";
import {
  createNextDeferLifetime,
  next,
  withCrux,
  withNextDefer,
} from "@use-crux/next";

describe("withNextDefer", () => {
  afterEach(() => {
    resetObservabilityRuntime();
  });

  it("declares an ambient response-finished host binding", () => {
    expect(next()).toMatchObject({
      kind: "next",
      invocationScope: true,
      supportsInline: true,
    });
  });

  it("declares response-finished completion and starts work only when after runs", async () => {
    let runAfter: (() => void | Promise<void>) | undefined;
    const after = vi.fn((task: () => void | Promise<void>) => {
      runAfter = task;
    });
    const started = vi.fn();

    const handle = withNextDefer(
      async () => {
        defer(() => {
          started();
        });
        return Response.json({ ok: true });
      },
      { after },
    );

    const response = await handle();
    expect(response).toBeInstanceOf(Response);
    expect(started).not.toHaveBeenCalled();
    expect(createNextDeferLifetime({ after }).completion).toBe(
      "response-finished",
    );

    await runAfter?.();
    expect(started).toHaveBeenCalledOnce();
  });

  it("delivers deferred evidence before the injected after task settles", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport, { scheduledDelayMs: 60_000 });
    let runAfter: (() => void | Promise<void>) | undefined;
    const handle = withNextDefer(
      async () => {
        defer(() => {});
        return Response.json({ ok: true });
      },
      {
        after(task) {
          runAfter = task;
        },
      },
    );

    await handle();
    expect(transport.records).toHaveLength(0);
    await runAfter?.();
    expect(
      transport.records.some(
        (record) =>
          record.type === "span:start" && record.primitive === "defer.run",
      ),
    ).toBe(true);
  });

  it("rejects unsupported Next versions that lack after()", () => {
    expect(() =>
      createNextDeferLifetime({
        // Simulate an older next/server export surface without after().
        after: null as unknown as () => void,
      }),
    ).toThrow(
      expect.objectContaining<Partial<CruxDeferError>>({
        code: "DEFER_CAPABILITY_MISSING",
      }),
    );
  });
});

describe("Next withCrux lifecycle", () => {
  afterEach(() => {
    resetObservabilityRuntime();
    vi.restoreAllMocks();
  });

  it("returns the exact response while the same after port owns deferred work and the final drain", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport, { scheduledDelayMs: 60_000 });
    const afterTasks: Array<() => void | Promise<void>> = [];
    const onDrain = vi.fn();
    let deferredCompleted = false;
    const handler = withCrux(
      async () => {
        observe.openRun({ name: "next-with-crux", rootPrimitive: "run" }).end();
        defer(() => {
          deferredCompleted = true;
        });
        return Response.json({ ok: true });
      },
      {
        after: (task) => afterTasks.push(task),
        onDrain,
      },
    );

    const response = await handler();

    expect(response).toBeInstanceOf(Response);
    expect(await response.json()).toEqual({ ok: true });
    expect(deferredCompleted).toBe(false);
    expect(transport.records).toHaveLength(0);
    expect(afterTasks).toHaveLength(1);

    for (const task of afterTasks) await task();
    expect(deferredCompleted).toBe(true);
    expect(transport.records).toContainEqual(
      expect.objectContaining({ type: "run:start", name: "next-with-crux" }),
    );
    expect(onDrain).toHaveBeenCalledWith(
      expect.objectContaining({ status: "drained" }),
    );
  });

  it("preserves the original throw and its classification while still scheduling the drain", async () => {
    const original = new Error("next not found control flow");
    const afterTasks: Array<() => void | Promise<void>> = [];
    const classifyOutcome = vi.fn(() => "not-found" as const);
    const onDrain = vi.fn();
    const handler = withCrux(
      async () => {
        throw original;
      },
      {
        after: (task) => afterTasks.push(task),
        classifyOutcome,
        onDrain,
      },
    );

    await expect(handler()).rejects.toBe(original);
    expect(classifyOutcome).toHaveBeenCalledWith({
      kind: "thrown",
      error: original,
    });
    expect(afterTasks).toHaveLength(1);

    for (const task of afterTasks) await task();
    expect(onDrain).toHaveBeenCalledWith(
      expect.objectContaining({ status: "drained" }),
    );
  });

  it("preserves the response and reports failure when the exporter throws", async () => {
    vi.spyOn(observe, "flush").mockRejectedValue(
      new Error("next exporter failed"),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const afterTasks: Array<() => void | Promise<void>> = [];
    const onDrain = vi.fn();
    const handler = withCrux(async () => "exact-next-result" as const, {
      after: (task) => afterTasks.push(task),
      onDrain,
    });

    await expect(handler()).resolves.toBe("exact-next-result");
    for (const task of afterTasks) await task();

    expect(onDrain).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", deadlineExceeded: false }),
    );
  });

  it("contains a throwing drain reporter without rejecting the after task", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const afterTasks: Array<() => void | Promise<void>> = [];
    const handler = withCrux(async () => ({ ok: true }) as const, {
      after: (task) => afterTasks.push(task),
      onDrain: () => {
        throw new Error("next reporter failed");
      },
    });

    await expect(handler()).resolves.toEqual({ ok: true });
    for (const task of afterTasks)
      await expect(task()).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("onDrain reporter threw"),
      expect.objectContaining({ message: "next reporter failed" }),
    );
  });

  it("contains a rejected async drain reporter without rejecting the after task", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const afterTasks: Array<() => void | Promise<void>> = [];
    let rejectReporter!: (error: Error) => void;
    const reporter = new Promise<void>((_resolve, reject) => {
      rejectReporter = reject;
    });
    const handler = withCrux(async () => "next-result" as const, {
      after: (task) => afterTasks.push(task),
      onDrain: () => reporter,
    });

    await expect(handler()).resolves.toBe("next-result");
    for (const task of afterTasks) {
      await expect(
        settlesBeforeReporter(Promise.resolve(task())),
      ).resolves.toBeUndefined();
    }
    rejectReporter(new Error("async next reporter failed"));
    await Promise.resolve();

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("onDrain reporter rejected"),
      expect.objectContaining({ message: "async next reporter failed" }),
    );
  });

  it("reports a truthful partial drain when the post-response budget expires", async () => {
    vi.spyOn(observe, "flush").mockResolvedValue({
      status: "deadline",
      delivered: 0,
      rejected: 0,
      remaining: 1,
      deadlineExceeded: true,
    });
    const afterTasks: Array<() => void | Promise<void>> = [];
    const onDrain = vi.fn();
    const handler = withCrux(
      async () => {
        observe
          .openRun({ name: "next-with-crux-deadline", rootPrimitive: "run" })
          .end();
        return "response";
      },
      {
        after: (task) => afterTasks.push(task),
        flushTimeoutMs: 5,
        onDrain,
      },
    );

    await expect(handler()).resolves.toBe("response");
    expect(afterTasks).toHaveLength(1);
    await afterTasks[0]!();

    expect(onDrain).toHaveBeenCalledWith(
      expect.objectContaining({ status: "deadline", deadlineExceeded: true }),
    );
  });

  it("uses a five-second default for the terminal drain", async () => {
    const flush = vi.spyOn(observe, "flush");
    const afterTasks: Array<() => void | Promise<void>> = [];
    const handler = withCrux(async () => "response", {
      after: (task) => afterTasks.push(task),
    });

    await handler();
    await afterTasks[0]!();

    expect(flush).toHaveBeenLastCalledWith({ timeoutMs: 5_000 });
  });

  it("preserves the handler argument tuple and awaited result type", () => {
    const handler = withCrux(
      async (request: Request, route: { readonly slug: string }) =>
        Response.json({ url: request.url, slug: route.slug }),
      { after: () => undefined },
    );

    expectTypeOf(handler).toEqualTypeOf<
      (request: Request, route: { readonly slug: string }) => Promise<Response>
    >();
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
