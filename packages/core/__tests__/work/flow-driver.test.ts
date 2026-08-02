import { afterEach, describe, expect, it } from "vitest";
import { flow } from "../../src/flow";
import { resetHooks, updateHooks } from "../../src/runtime/runtime";
import { inMemoryRecordStore } from "../../src/storage";
import { createFlowWorkDriver } from "../../src/work/internal/flow-driver";
import { createProcessLocalWorkKernel } from "../../src/work/internal/process-local-kernel";

describe("process-local Work Flow driver", () => {
  afterEach(() => {
    resetHooks();
  });

  it("forwards input that resembles Flow run options as business input", async () => {
    const input = { flowId: "business_flow_id" };
    const target = flow(
      "work driver FlowRunOptions-like input",
      async (_scope, received: { flowId: string }) => received.flowId,
    );
    const kernel = createProcessLocalWorkKernel({
      createId: () => "work_flow_driver_input",
      schedule: (start) => start(),
    });

    const handle = await kernel.spawn(createFlowWorkDriver(target, input));

    await expect(handle.result()).resolves.toBe("business_flow_id");
  });

  it("rejects a suspended Flow result as non-completed", async () => {
    updateHooks({ records: inMemoryRecordStore() });
    const target = flow("work driver suspended result", async (scope) => {
      await scope.suspend("work-driver-approval");
      return "unreachable";
    });
    const kernel = createProcessLocalWorkKernel({
      createId: () => "work_flow_driver_suspended",
      schedule: (start) => start(),
    });

    const handle = await kernel.spawn(createFlowWorkDriver(target));
    let rejection: unknown;
    try {
      await handle.result();
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toBeInstanceOf(TypeError);
    expect(rejection).toMatchObject({
      message:
        "Flow `work driver suspended result` reached `suspended` before Work completion.",
    });
  });

  it("preserves the exact rejection from a throwing Flow", async () => {
    const sentinel = Object.freeze({ kind: "work-flow-driver-rejection" });
    const target = flow("work driver original rejection", async () => {
      throw sentinel;
    });
    const kernel = createProcessLocalWorkKernel({
      createId: () => "work_flow_driver_rejection",
      schedule: (start) => start(),
    });

    const handle = await kernel.spawn(createFlowWorkDriver(target));

    await expect(handle.result()).rejects.toBe(sentinel);
  });
});
