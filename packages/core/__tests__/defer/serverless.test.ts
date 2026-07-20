import { afterEach, describe, expect, it, vi } from "vitest";
import { defer, type CruxDeferError } from "@use-crux/core";
import {
  withAfterDefer,
  withNamedOnlyDefer,
  withWaitUntilDefer,
  SERVERLESS_DEFER_POLICY,
} from "@use-crux/core/defer/serverless";
import { durableTask } from "@use-crux/core/runtime";
import { createTestRuntime } from "@use-crux/core/runtime/testing";
import {
  createInMemoryObservabilityTransport,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../../src/observability";

describe("serverless defer hosts", () => {
  afterEach(() => {
    resetObservabilityRuntime();
  });

  it("declares handler-returned waitUntil semantics and retains drain after the handler returns", async () => {
    const retained: Promise<void>[] = [];
    let releaseDrain!: () => void;
    const drainGate = new Promise<void>((resolve) => {
      releaseDrain = resolve;
    });
    const waitUntil = vi.fn((promise: Promise<void>) => {
      retained.push(promise);
    });
    const started = vi.fn();
    const handle = withWaitUntilDefer(
      async () => {
        defer(async () => {
          started();
          await drainGate;
        });
        // Streaming body may still be open when drain starts.
        return new Response("streaming");
      },
      { waitUntil },
    );

    const response = await handle();
    expect(response).toBeInstanceOf(Response);
    expect(waitUntil).toHaveBeenCalledOnce();
    // Handler-returned work may already have started while the Response is held.
    expect(started).toHaveBeenCalledOnce();
    releaseDrain();
    await Promise.all(retained);
  });

  it("declares response-finished after() semantics and starts only when after runs", async () => {
    let runAfter: (() => void | Promise<void>) | undefined;
    const after = vi.fn((task: () => void | Promise<void>) => {
      runAfter = task;
    });
    const started = vi.fn();
    const handle = withAfterDefer(
      async () => {
        defer(() => {
          started();
        });
        return "ok";
      },
      { after },
    );

    await expect(handle()).resolves.toBe("ok");
    expect(started).not.toHaveBeenCalled();

    await runAfter?.();
    expect(started).toHaveBeenCalledOnce();
  });

  it("flushes response-finished deferred evidence inside the after task", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport, { scheduledDelayMs: 60_000 });

    let runAfter: (() => void | Promise<void>) | undefined;
    const handler = withAfterDefer(
      async () => {
        defer(() => {});
        return "ok";
      },
      {
        after(task) {
          runAfter = task;
        },
      },
    );

    await expect(handler()).resolves.toBe("ok");
    expect(transport.records).toHaveLength(0);
    await runAfter?.();
    expect(
      transport.records.some(
        (record) =>
          record.type === "span:start" && record.primitive === "defer.run",
      ),
    ).toBe(true);
  });

  it("bounds the retained-task flush when delivery remains retryable", async () => {
    vi.useFakeTimers();
    setObservabilityTransport(
      {
        send() {
          return { dispositions: [], retryAfterMs: 1_000 };
        },
      },
      {
        scheduledDelayMs: 60_000,
        retryDelayMs: 1_000,
        maxRetryDelayMs: 1_000,
        retryJitterRatio: 0,
      },
    );
    const retained: Promise<void>[] = [];
    const handler = withWaitUntilDefer(
      async () => {
        defer(() => {});
        return "ok";
      },
      {
        waitUntil(promise) {
          retained.push(promise);
        },
      },
    );

    await handler();
    let settled = false;
    void retained[0]?.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(2_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(retained[0]).resolves.toBeUndefined();
  });

  it("never infers a binding from platform environment names", async () => {
    const previous = process.env.VERCEL;
    process.env.VERCEL = "1";
    try {
      await expect(
        withNamedOnlyDefer(
          async () => {
            defer(() => {});
            return "ok";
          },
          { host: "generic" },
        )(),
      ).rejects.toMatchObject({
        code: "DEFER_CAPABILITY_MISSING",
      } satisfies Partial<CruxDeferError>);
    } finally {
      if (previous === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = previous;
    }
  });

  it("rejects Lambda-style inline callbacks while accepting named Runtime work", async () => {
    const target = durableTask("lambda-named-target", {
      run: async (input: { readonly id: string }) => input.id,
    });
    const testRuntime = createTestRuntime({ targets: [target] });
    try {
      const inline = withNamedOnlyDefer(
        async () => {
          defer(() => {});
          return "nope";
        },
        { host: "lambda" },
      );
      await expect(inline()).rejects.toMatchObject({
        code: "DEFER_CAPABILITY_MISSING",
      });

      const named = withNamedOnlyDefer(
        async () => {
          const reference = await defer(target, { id: "1" });
          return reference;
        },
        { host: "lambda", durableFinalization: true },
      );
      const reference = await named();
      expect(reference).toMatchObject({
        kind: "deferred.work",
        targetId: "lambda-named-target",
      });
      await expect(
        testRuntime.store.state.getWork(reference.workId, {
          namespace: "local",
        }),
      ).resolves.toMatchObject({ status: "pending" });
    } finally {
      testRuntime.dispose();
    }
  });

  it("rejects missing waitUntil and after ports before registration", () => {
    expect(() =>
      withWaitUntilDefer(async () => undefined, {
        waitUntil: undefined as unknown as (promise: Promise<void>) => void,
      }),
    ).toThrow(expect.objectContaining({ code: "DEFER_CAPABILITY_MISSING" }));
    expect(() =>
      withAfterDefer(async () => undefined, {
        after: undefined as unknown as (
          task: () => void | Promise<void>,
        ) => void,
      }),
    ).toThrow(expect.objectContaining({ code: "DEFER_CAPABILITY_MISSING" }));
  });

  it("exposes fixed V1 serverless limits", () => {
    expect(SERVERLESS_DEFER_POLICY).toEqual({
      maxDrainMs: 30_000,
      maxCallbacks: 64,
      concurrency: 4,
      maxNestingDepth: 4,
    });
  });

  it("keeps process-local waitUntil drains isolated across concurrent hosts", async () => {
    const firstRetained: Promise<void>[] = [];
    const secondRetained: Promise<void>[] = [];
    const firstStarted = vi.fn();
    const secondStarted = vi.fn();

    const first = withWaitUntilDefer(
      async () => {
        defer(() => {
          firstStarted();
        });
        return "a";
      },
      {
        waitUntil: (promise) => {
          firstRetained.push(promise);
        },
      },
    );
    const second = withWaitUntilDefer(
      async () => {
        defer(() => {
          secondStarted();
        });
        return "b";
      },
      {
        waitUntil: (promise) => {
          secondRetained.push(promise);
        },
      },
    );

    await expect(Promise.all([first(), second()])).resolves.toEqual(["a", "b"]);
    await Promise.all([...firstRetained, ...secondRetained]);
    expect(firstStarted).toHaveBeenCalledOnce();
    expect(secondStarted).toHaveBeenCalledOnce();
    expect(firstRetained).toHaveLength(1);
    expect(secondRetained).toHaveLength(1);
  });
});
