import { describe, expect, it, vi } from "vitest";
import { defer, type CruxDeferError } from "@use-crux/core";
import {
  createAfterDeferLifetime,
  createNamedOnlyDeferLifetime,
  createWaitUntilDeferLifetime,
  withAfterDefer,
  withNamedOnlyDefer,
  withServerlessDefer,
  withWaitUntilDefer,
  SERVERLESS_DEFER_POLICY,
} from "@use-crux/core/defer/serverless";
import { durableTask } from "@use-crux/core/runtime";
import { createTestRuntime } from "@use-crux/core/runtime/testing";

describe("serverless defer hosts", () => {
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
    expect(createWaitUntilDeferLifetime({ waitUntil }).completion).toBe(
      "handler-returned",
    );
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
    expect(createAfterDeferLifetime({ after }).completion).toBe(
      "response-finished",
    );

    await runAfter?.();
    expect(started).toHaveBeenCalledOnce();
  });

  it("never infers a lifetime from platform environment names", async () => {
    const previous = process.env.VERCEL;
    process.env.VERCEL = "1";
    try {
      await expect(
        withServerlessDefer(
          async () => {
            defer(() => {});
            return "ok";
          },
          {
            lifetime: createNamedOnlyDeferLifetime({ host: "generic" }),
          },
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
      createWaitUntilDeferLifetime({
        waitUntil: undefined as unknown as (promise: Promise<void>) => void,
      }),
    ).toThrow(
      expect.objectContaining({ code: "DEFER_CAPABILITY_MISSING" }),
    );
    expect(() =>
      createAfterDeferLifetime({
        after: undefined as unknown as (task: () => void | Promise<void>) => void,
      }),
    ).toThrow(
      expect.objectContaining({ code: "DEFER_CAPABILITY_MISSING" }),
    );
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
