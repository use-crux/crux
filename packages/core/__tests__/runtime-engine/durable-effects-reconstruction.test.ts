import { afterEach, describe, expect, it, vi } from "vitest";
import { config, effect, flow } from "@use-crux/core";
import { rollbackOnError } from "@use-crux/core/effect";
import { inMemoryRuntimeStore, node } from "@use-crux/core/runtime";
import { resetEffectDefinitionsForTesting } from "../../src/effect/define-effect";
import { resetHooks } from "../../src/runtime/runtime";

afterEach(() => {
  resetEffectDefinitionsForTesting();
  resetHooks();
});

describe("durable Effect reconstruction", () => {
  it("persists a recovered child boundary in its parent plan", async () => {
    const store = inMemoryRuntimeStore();
    const runtime = config({
      runtime: node({
        namespace: "tenant-a",
        store,
        autoStartMaintenance: false,
      }),
    });
    const recover = vi.fn(async () => undefined);
    const update = effect("customer.nested-update", async () => "updated", {
      recover,
    });
    const nestedFlow = flow("nested-durable-flow", async () => {
      await expect(
        rollbackOnError(async () => {
          await update();
          throw new Error("rollback child");
        }),
      ).rejects.toThrow("rollback child");
    });

    const completed = await nestedFlow.run();
    const parent = await store.effects.reconstructScope(completed.effects, {
      namespace: "tenant-a",
    });

    expect(recover).toHaveBeenCalledOnce();
    expect(parent?.plan).toEqual([
      expect.objectContaining({
        kind: "boundary",
        status: "already_recovered",
      }),
    ]);
    runtime.dispose();
  });
});
