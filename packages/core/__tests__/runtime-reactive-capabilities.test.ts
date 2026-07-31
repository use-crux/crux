import { afterEach, describe, expect, it } from "vitest";
import { config, flow, signal } from "@use-crux/core";
import {
  inMemoryRuntimeStore,
  node,
  type RuntimeStoreAdapter,
} from "@use-crux/core/runtime";
import { resetHooks } from "../src/runtime/runtime";
import { z } from "zod";

afterEach(() => {
  resetHooks();
});

describe("reactive Runtime capability preflight", () => {
  it("rejects a durable Flow Signal wait before acceptance on process-local storage", async () => {
    const checksChanged = signal({
      id: "ci.checks.changed",
      schema: z.object({ sha: z.string() }),
    });
    const crux = config({
      runtime: node({ autoStartMaintenance: false }),
    });
    let entered = false;
    const release = flow(
      "release",
      { signals: { checksChanged } },
      async (scope) => {
        entered = true;
        await scope.waitFor(checksChanged);
      },
    );

    await expect(release.run()).rejects.toMatchObject({
      code: "CAPABILITY_MISSING",
      whatFailed:
        "Flow `release` cannot activate durable Signal wait `ci.checks.changed`.",
      why: expect.stringContaining("process-local Runtime storage"),
      whatStillWorks: expect.stringContaining("process-local Signal callbacks"),
      nextStep: expect.stringContaining("node({ store: durableRuntimeStore })"),
    });
    expect(entered).toBe(false);

    crux.dispose();
  });

  it("rejects a durable Flow Signal wait before allocation when its store lacks Signal storage", async () => {
    const checksChanged = signal({
      id: "ci.checks.changed",
      schema: z.object({ sha: z.string() }),
    });
    const store = durableStoreWithoutSignalStorage();
    const crux = config({
      runtime: node({
        store,
        namespace: "missing-signal-storage",
        autoStartMaintenance: false,
      }),
    });
    let entered = false;
    const release = flow(
      "release-without-signal-storage",
      { signals: { checksChanged } },
      async (scope) => {
        entered = true;
        await scope.waitFor(checksChanged);
      },
    );

    await expect(release.run()).rejects.toMatchObject({
      code: "CAPABILITY_MISSING",
      whatFailed:
        "Flow `release-without-signal-storage` cannot activate durable Signal wait `ci.checks.changed`.",
      why: expect.stringContaining("Signal storage"),
      whatStillWorks: expect.stringContaining("process-local Signal callbacks"),
      nextStep: expect.stringContaining("`signals` port"),
    });
    expect(entered).toBe(false);
    await expect(
      store.state.countWork({ namespace: "missing-signal-storage" }),
    ).resolves.toEqual([]);

    crux.dispose();
  });

  it("reports legacy store durability as unproven before allocation", async () => {
    const checksChanged = signal({
      id: "ci.checks.changed",
      schema: z.object({ sha: z.string() }),
    });
    const store = storeWithoutDurabilityMarker();
    const crux = config({
      runtime: node({
        store,
        namespace: "unproven-store-durability",
        autoStartMaintenance: false,
      }),
    });
    const release = flow(
      "release-with-unproven-store-durability",
      { signals: { checksChanged } },
      async (scope) => {
        await scope.waitFor(checksChanged);
      },
    );

    await expect(release.run()).rejects.toMatchObject({
      code: "CAPABILITY_MISSING",
      why: expect.stringContaining("does not declare durable Runtime storage"),
      nextStep: expect.stringContaining("declares `durability: \"durable\"`"),
    });
    await expect(
      store.state.countWork({ namespace: "unproven-store-durability" }),
    ).resolves.toEqual([]);

    crux.dispose();
  });
});

function durableStoreWithoutSignalStorage(): RuntimeStoreAdapter {
  const { signals: _signals, ...store } = inMemoryRuntimeStore();
  return Object.freeze({ ...store, durability: "durable" as const });
}

function storeWithoutDurabilityMarker(): RuntimeStoreAdapter {
  const { durability: _durability, ...store } = inMemoryRuntimeStore();
  return Object.freeze(store);
}
