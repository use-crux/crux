import { afterEach, describe, expect, it, vi } from "vitest";
import { config, flow, signal } from "@use-crux/core";
import { node } from "@use-crux/core/runtime";
import { resetHooks } from "../src/runtime/runtime";
import { durableMemoryRuntimeStore } from "./signal-durable-test-helpers";
import { z } from "zod";

afterEach(() => {
  vi.unstubAllGlobals();
  resetHooks();
});

describe("Signal occurrence identity", () => {
  it("uses secure random bytes when randomUUID is unavailable", async () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.forEach((_, index) => {
        bytes[index] = index;
      });
      return bytes;
    });
    vi.stubGlobal("crypto", { getRandomValues });
    const changed = signal({ id: "identity.changed", schema: z.string() });

    const receipt = await changed.publish("accepted");

    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(receipt.occurrenceId).toBe(
      "signal_occurrence_000102030405060708090a0b0c0d0e0f",
    );
  });

  it("rejects durable acceptance when secure randomness is unavailable", async () => {
    const store = durableMemoryRuntimeStore();
    const crux = config({
      runtime: node({
        store,
        namespace: "signal-identity-test",
        autoStartMaintenance: false,
      }),
    });
    const changed = signal({ id: "identity.durable", schema: z.string() });
    const release = flow(
      "identity durable consumer",
      { signals: { changed } },
      async (scope) => {
        await scope.waitFor(changed);
      },
    );

    try {
      await release.run({ flowId: "flow_signal_identity" });
      vi.stubGlobal("crypto", undefined);

      await expect(changed.publish("accepted")).rejects.toMatchObject({
        code: "CAPABILITY_MISSING",
        why: expect.stringContaining("secure randomness"),
      });
      await expect(
        store.events.read({ namespace: "signal-identity-test" }),
      ).resolves.toMatchObject({ events: [] });
    } finally {
      vi.unstubAllGlobals();
      crux.dispose();
    }
  });
});
