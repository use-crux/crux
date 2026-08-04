import { afterEach, describe, expect, it, vi } from "vitest";

import { config, flow } from "@use-crux/core";
import { effect, recover, rollback } from "@use-crux/core/effect";
import {
  CruxRuntimeError,
  createRuntimeProgram,
  inMemoryRuntimeStore,
  node,
} from "@use-crux/core/runtime";
import { resetEffectDefinitionsForTesting } from "../../src/effect/define-effect";
import { resetEffectLedgerForTesting } from "../../src/effect/internal/ledger";
import { resetHooks } from "../../src/runtime/runtime";

afterEach(() => {
  resetEffectDefinitionsForTesting();
  resetHooks();
});

describe("RuntimeProgram Effect recovery targets", () => {
  it("projects recoverable definitions to immutable identity declarations", () => {
    const update = effect("customer.update", async () => "updated", {
      version: 2,
      recover: async () => undefined,
    });

    const program = createRuntimeProgram({
      targets: [],
      transports: [],
      effectTargets: [update],
    });

    expect(program.effectTargets).toEqual([
      { id: "customer.update", version: 2 },
    ]);
    expect(Object.isFrozen(program.effectTargets)).toBe(true);
    expect(Object.isFrozen(program.effectTargets[0])).toBe(true);
  });

  it("collapses identical declarations and rejects conflicting target identities", () => {
    const first = effect("customer.update", async () => "updated", {
      recover: async () => undefined,
    });
    const collapsed = createRuntimeProgram({
      targets: [],
      transports: [],
      effectTargets: [first, first],
    });
    expect(collapsed.effectTargets).toEqual([
      { id: "customer.update", version: 1 },
    ]);

    resetEffectDefinitionsForTesting();
    const conflicting = effect("customer.update", async () => "updated", {
      recover: async () => undefined,
    });

    expect(() =>
      createRuntimeProgram({
        targets: [],
        transports: [],
        effectTargets: [first, conflicting],
      }),
    ).toThrow(CruxRuntimeError);
    expect(() =>
      createRuntimeProgram({
        targets: [],
        transports: [],
        effectTargets: [first, conflicting],
      }),
    ).toThrow(/Code: TARGET_DUPLICATE/);
  });

  it("reports handler_unavailable when a durable recovery target is missing", async () => {
    const store = inMemoryRuntimeStore();
    const recover = vi.fn(async () => undefined);
    const update = effect("customer.missing-update", async () => "updated", {
      recover,
    });
    const program = createRuntimeProgram({
      targets: [],
      transports: [],
      effectTargets: [update],
    });
    const firstRuntime = config({
      runtime: node({
        store,
        program,
        namespace: "tenant-a",
        autoStartMaintenance: false,
      }),
    });
    const updateFlow = flow("missing-update-flow", async () => {
      await update();
    });
    const completed = await updateFlow.run();
    firstRuntime.dispose();

    const restartedRuntime = config({
      runtime: node({
        store: store.testing.restart(),
        program: createRuntimeProgram({
          targets: [],
          transports: [],
          effectTargets: [],
        }),
        namespace: "tenant-a",
        autoStartMaintenance: false,
      }),
    });

    await expect(rollback(completed.effects)).resolves.toMatchObject({
      status: "not_possible",
      units: [{ status: "handler_unavailable" }],
    });
    expect(recover).not.toHaveBeenCalled();
    restartedRuntime.dispose();
  });

  it("reports the exact-version mismatch as handler_unavailable", async () => {
    const store = inMemoryRuntimeStore();
    const recoverV1 = vi.fn(async () => undefined);
    const updateV1 = effect(
      "customer.versioned-update",
      async () => "updated",
      { version: 1, recover: recoverV1 },
    );
    const firstRuntime = config({
      runtime: node({
        store,
        program: createRuntimeProgram({
          targets: [],
          transports: [],
          effectTargets: [updateV1],
        }),
        namespace: "tenant-a",
        autoStartMaintenance: false,
      }),
    });
    const updateFlow = flow("versioned-update-flow", async () => {
      await updateV1();
    });
    const completed = await updateFlow.run();
    firstRuntime.dispose();

    const recoverV2 = vi.fn(async () => undefined);
    const updateV2 = effect(
      "customer.versioned-update",
      async () => "updated",
      { version: 2, recover: recoverV2 },
    );
    const restartedRuntime = config({
      runtime: node({
        store: store.testing.restart(),
        program: createRuntimeProgram({
          targets: [],
          transports: [],
          effectTargets: [updateV2],
        }),
        namespace: "tenant-a",
        autoStartMaintenance: false,
      }),
    });

    await expect(rollback(completed.effects)).resolves.toMatchObject({
      status: "not_possible",
      units: [
        {
          status: "handler_unavailable",
          error: {
            code: "EFFECT_RECOVERY_HANDLER_UNAVAILABLE",
            message: expect.stringMatching(/version 1/),
          },
        },
      ],
    });
    expect(recoverV1).not.toHaveBeenCalled();
    expect(recoverV2).not.toHaveBeenCalled();
    restartedRuntime.dispose();
  });

  it("recovers through the exact definition owned by the restarted program", async () => {
    const store = inMemoryRuntimeStore();
    const firstDefinition = effect(
      "customer.reloaded-update",
      async () => "updated",
      { recover: async () => undefined },
    );
    const firstRuntime = config({
      runtime: node({
        store,
        program: createRuntimeProgram({
          targets: [],
          transports: [],
          effectTargets: [firstDefinition],
        }),
        namespace: "tenant-a",
        autoStartMaintenance: false,
      }),
    });
    const execution = await firstDefinition.run();
    firstRuntime.dispose();
    resetEffectDefinitionsForTesting();
    resetEffectLedgerForTesting();

    const recoverReloaded = vi.fn(async () => undefined);
    const reloadedDefinition = effect(
      "customer.reloaded-update",
      async () => "updated again",
      { recover: recoverReloaded },
    );
    const restartedRuntime = config({
      runtime: node({
        store: store.testing.restart(),
        program: createRuntimeProgram({
          targets: [],
          transports: [],
          effectTargets: [reloadedDefinition],
        }),
        namespace: "tenant-a",
        autoStartMaintenance: false,
      }),
    });

    await expect(recover(execution.receipt)).resolves.toMatchObject({
      status: "recovered",
    });
    expect(recoverReloaded).toHaveBeenCalledTimes(1);
    restartedRuntime.dispose();
  });

  it("keeps recovery closures out of serialized target identity", () => {
    const update = effect("customer.serializable-update", async () => "updated", {
      recover: async () => undefined,
    });
    const program = createRuntimeProgram({
      targets: [],
      transports: [],
      effectTargets: [update],
    });

    expect(Reflect.ownKeys(program.effectTargets[0] ?? {})).toEqual([
      "id",
      "version",
    ]);
    expect(
      Object.values(program.effectTargets[0] ?? {}).some(
        (value) => typeof value === "function",
      ),
    ).toBe(false);
    expect(JSON.parse(JSON.stringify(program))).toMatchObject({
      effectTargets: [{ id: "customer.serializable-update", version: 1 }],
    });
  });

  it("rejects a recoverable Effect in a durable scope without a declared target", async () => {
    const store = inMemoryRuntimeStore();
    const execute = vi.fn(async () => "updated");
    const update = effect("customer.undeclared-update", execute, {
      recover: async () => undefined,
    });
    const runtime = config({
      runtime: node({
        store,
        program: createRuntimeProgram({
          targets: [],
          transports: [],
          effectTargets: [],
        }),
        namespace: "tenant-a",
        autoStartMaintenance: false,
      }),
    });

    await expect(update.run()).rejects.toMatchObject({
      code: "TARGET_NOT_FOUND",
      whatFailed: expect.stringMatching(/customer\.undeclared-update/),
      nextStep: expect.stringMatching(/effectTargets/),
    });
    expect(execute).not.toHaveBeenCalled();
    runtime.dispose();
  });
});
