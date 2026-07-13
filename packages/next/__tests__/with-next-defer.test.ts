import { afterEach, describe, expect, it, vi } from "vitest";
import { defer, type CruxDeferError } from "@use-crux/core";
import {
  createInMemoryObservabilityTransport,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "@use-crux/core/observability";
import {
  createNextDeferLifetime,
  withNextDefer,
} from "@use-crux/next";

describe("withNextDefer", () => {
  afterEach(() => {
    resetObservabilityRuntime();
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
