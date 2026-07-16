import { describe, expect, it } from "vitest";
import * as runtimePublic from "@use-crux/core/runtime";
import * as evalRegistryInternal from "@use-crux/core/runtime/internal/eval-registry";
import * as evalHostInternal from "@use-crux/core/runtime/internal/eval-host";
import {
  createOutboxDispatcher,
  createRuntime,
  createRuntimeKernel,
  durableTask,
  inMemoryRuntimeStore,
  node,
  runtimeRequiredError,
  type RuntimeEngineDefinition,
} from "@use-crux/core/runtime";
import {
  createTestRuntime,
  runRuntimeEngineAdapterTests,
  runStoreAdapterTests,
} from "@use-crux/core/runtime/testing";

describe("@use-crux/core runtime store public surface", () => {
  it("exports the in-memory store and conformance suite from package subpaths", () => {
    expect(typeof inMemoryRuntimeStore).toBe("function");
    expect(typeof inMemoryRuntimeStore().transact).toBe("function");
    expect(typeof createRuntimeKernel).toBe("function");
    expect(typeof createOutboxDispatcher).toBe("function");
    expect(typeof createRuntime).toBe("function");
    expect(typeof durableTask).toBe("function");
    expect("task" in runtimePublic).toBe(false);
    expect(typeof node).toBe("function");
    expect(typeof runtimeRequiredError).toBe("function");
    expect(typeof runStoreAdapterTests).toBe("function");
    expect(typeof runRuntimeEngineAdapterTests).toBe("function");
    expect(typeof createTestRuntime).toBe("function");
    expect(runtimePublic.RUNTIME_RESULT_MAX_BYTES).toBe(1024 * 1024);
    expect(runtimePublic.RUNTIME_RESULT_MEDIA_TYPE).toBe(
      "application/vnd.crux.eval-result+json",
    );
    expect(evalRegistryInternal.createDeployedEvalRegistry).toBeTypeOf(
      "function",
    );
    expect("createDeployedEvalRegistry" in runtimePublic).toBe(false);
    expect(evalHostInternal.createMemoryEvalHost).toBeTypeOf("function");
    expect(evalHostInternal.createEvalHostClient).toBeTypeOf("function");
    expect("createMemoryEvalHost" in runtimePublic).toBe(false);
  });

  it("uses adapter-neutral remediation for capability preflight failures", () => {
    const runtime = {
      kind: "in-process",
      id: "missing-events",
      store: inMemoryRuntimeStore(),
      capabilities: {
        timers: { durable: true },
        wake: { atLeastOnce: true, signed: false },
        events: { durable: false, cursorReads: false },
        waiters: { durable: true },
        leases: { durable: true },
        live: { available: false },
        setup: { canCheck: false, canApply: false },
        deployment: {
          serverless: "unsupported",
          edge: "unsupported",
          multiProcess: "unsupported",
        },
      },
      createWake: () => async () => undefined,
    } satisfies RuntimeEngineDefinition;

    expect(() => createRuntime({ runtime, startMaintenance: false })).toThrow(
      /Choose a Runtime Engine adapter that implements durable event cursor reads, then run its setup check or conformance tests./,
    );
  });
});
