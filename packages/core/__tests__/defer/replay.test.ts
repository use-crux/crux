import { afterEach, describe, expect, it } from "vitest";
import { config, defer, flow } from "@use-crux/core";
import { durableTask, node } from "@use-crux/core/runtime";
import { resetHooks } from "../../src/runtime/runtime";

afterEach(() => {
  resetHooks();
});

describe("defer() replay safety", () => {
  it("rejects public inline defer from a replayable flow body", async () => {
    const crux = config({
      runtime: node({ autoStartMaintenance: false }),
    });
    const unsafe = flow("public-defer-in-flow", async () => {
      defer(() => undefined);
    });

    await expect(unsafe.run()).rejects.toMatchObject({
      code: "DEFER_REPLAY_UNSAFE",
      message: expect.stringContaining(
        "defer() cannot run inside replayable flow execution",
      ),
    });

    crux.dispose();
  });

  it("rejects public named defer from a replayable flow step", async () => {
    const task = durableTask("public-defer-in-step-task", {
      run: async (input: { readonly documentId: string }) => input.documentId,
    });
    const crux = config({
      runtime: node({ autoStartMaintenance: false }),
    });
    const unsafe = flow("public-defer-in-step", async (scope) => {
      await scope.step("schedule", async () => {
        await defer(task, { documentId: "doc_1" });
      });
    });

    await expect(unsafe.run()).rejects.toMatchObject({
      code: "DEFER_REPLAY_UNSAFE",
      message: expect.stringContaining("Use flow.defer()"),
    });

    crux.dispose();
  });
});
