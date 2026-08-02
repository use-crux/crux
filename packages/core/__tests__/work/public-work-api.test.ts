import { describe, expect, it, vi } from "vitest";
import { flow, getWork, spawn, type WorkId } from "../../src";

describe("public durable Work API", () => {
  it("reports the missing durable host bridge without executing the Flow inline", async () => {
    const run = vi.fn(async () => "done" as const);
    const target = flow("durable-host-required", run);

    await expect(
      spawn(target, undefined, { idempotencyKey: "request_1" }),
    ).rejects.toMatchObject({
      name: "CruxRuntimeError",
      code: "CAPABILITY_MISSING",
    });
    await expect(
      getWork(target, "work_missing" as WorkId<typeof target>),
    ).rejects.toMatchObject({
      name: "CruxRuntimeError",
      code: "CAPABILITY_MISSING",
    });
    expect(run).not.toHaveBeenCalled();
  });
});
