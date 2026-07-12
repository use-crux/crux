import { describe, expect, it, vi } from "vitest";
import { defer, type CruxDeferError } from "@use-crux/core";
import {
  createNextDeferLifetime,
  withNextDefer,
} from "@use-crux/next";

describe("withNextDefer", () => {
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
