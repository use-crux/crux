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
import { resetEffectOccurrencesForTesting } from "../../src/effect/internal/occurrence";
import { resetHooks } from "../../src/runtime/runtime";

afterEach(() => {
  resetEffectDefinitionsForTesting();
  resetEffectLedgerForTesting();
  resetEffectOccurrencesForTesting();
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
    resetEffectLedgerForTesting();

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
    resetEffectLedgerForTesting();

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

  it("keeps an undeclared recoverable Effect callable and reports handler_unavailable after restart", async () => {
    const store = inMemoryRuntimeStore();
    const execute = vi.fn(async () => "updated");
    const recoverUpdate = vi.fn(async () => undefined);
    const update = effect("customer.undeclared-update", execute, {
      recover: recoverUpdate,
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

    const execution = await update.run();
    expect(execution.output).toBe("updated");
    expect(execute).toHaveBeenCalledOnce();
    runtime.dispose();
    resetEffectLedgerForTesting();

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

    await expect(recover(execution.receipt)).resolves.toMatchObject({
      status: "handler_unavailable",
      error: {
        code: "EFFECT_RECOVERY_HANDLER_UNAVAILABLE",
        message: expect.stringMatching(/customer\.undeclared-update/),
      },
    });
    expect(recoverUpdate).not.toHaveBeenCalled();
    restartedRuntime.dispose();
  });

  it("recovers an undeclared durable Effect through its live definition", async () => {
    const recoverUpdate = vi.fn(async () => undefined);
    const update = effect("customer.live-update", async () => "updated", {
      recover: recoverUpdate,
    });
    const runtime = config({
      runtime: node({
        store: inMemoryRuntimeStore(),
        program: createRuntimeProgram({
          targets: [],
          transports: [],
          effectTargets: [],
        }),
        namespace: "tenant-a",
        autoStartMaintenance: false,
      }),
    });

    const execution = await update.run();

    await expect(recover(execution.receipt)).resolves.toMatchObject({
      status: "recovered",
    });
    expect(recoverUpdate).toHaveBeenCalledOnce();
    runtime.dispose();
  });

  it("retains a live handler for a process-only recovery envelope", async () => {
    const recoverUpdate = vi.fn(async () => undefined);
    const update = effect(
      "customer.process-only-update",
      async (input: Map<string, string>) => input.get("status"),
      { recover: recoverUpdate },
    );
    const runtime = config({
      runtime: node({
        store: inMemoryRuntimeStore(),
        program: createRuntimeProgram({
          targets: [],
          transports: [],
          effectTargets: [],
        }),
        namespace: "tenant-a",
        autoStartMaintenance: false,
      }),
    });

    const execution = await update.run(new Map([["status", "updated"]]));

    await expect(recover(execution.receipt)).resolves.toMatchObject({
      status: "recovered",
    });
    expect(recoverUpdate).toHaveBeenCalledOnce();
    runtime.dispose();
  });

  it("does not reuse a colliding live handler from another Runtime partition", async () => {
    const firstStore = inMemoryRuntimeStore();
    const recoverFirst = vi.fn(async () => undefined);
    const first = effect("customer.first-update", async () => "first", {
      recover: recoverFirst,
    });
    const firstRuntime = config({
      runtime: node({
        store: firstStore,
        program: createRuntimeProgram({
          targets: [],
          transports: [],
          effectTargets: [],
        }),
        namespace: "tenant-a",
        autoStartMaintenance: false,
      }),
    });
    const firstExecution = await first.run();
    firstRuntime.dispose();
    resetEffectLedgerForTesting();
    resetEffectOccurrencesForTesting();

    const recoverSecond = vi.fn(async () => undefined);
    const second = effect("customer.second-update", async () => "second", {
      recover: recoverSecond,
    });
    const secondRuntime = config({
      runtime: node({
        store: inMemoryRuntimeStore(),
        program: createRuntimeProgram({
          targets: [],
          transports: [],
          effectTargets: [],
        }),
        namespace: "tenant-b",
        autoStartMaintenance: false,
      }),
    });
    const secondExecution = await second.run();
    expect(secondExecution.receipt.id).toBe(firstExecution.receipt.id);
    secondRuntime.dispose();

    const restartedRuntime = config({
      runtime: node({
        store: firstStore.testing.restart(),
        program: createRuntimeProgram({
          targets: [],
          transports: [],
          effectTargets: [],
        }),
        namespace: "tenant-a",
        autoStartMaintenance: false,
      }),
    });

    await expect(recover(firstExecution.receipt)).resolves.toMatchObject({
      status: "handler_unavailable",
    });
    expect(recoverFirst).not.toHaveBeenCalled();
    expect(recoverSecond).not.toHaveBeenCalled();
    restartedRuntime.dispose();
  });
});
