import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getExecutionContext,
  inMemoryRecordStore,
  runWithExecutionContext,
} from "@use-crux/core";
import {
  createRuntimeWithHostContext,
  runWithRuntimeHost,
  type HostBoundRuntimeEngineDefinition,
  type RuntimeHostBinder,
} from "@use-crux/core/runtime";
import {
  __setAlsForTesting,
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "@use-crux/core/observability";
import { getConvexCruxRuntime, runWithConvexCruxRuntime } from "../src/runtime";

describe("Convex canonical async scope", () => {
  afterEach(() => {
    __setAlsForTesting("auto");
    resetObservabilityRuntime();
    vi.restoreAllMocks();
  });

  it("supports synchronous fallback and rejects async use without late leakage", async () => {
    __setAlsForTesting(null);
    const records = inMemoryRecordStore();
    const runtime = { ctx: {}, storage: { records }, records };
    let synchronousRuntime = false;
    let lateRuntime: unknown;

    const result = runWithConvexCruxRuntime(runtime, async () => {
      synchronousRuntime = getConvexCruxRuntime() === runtime;
      await Promise.resolve();
      lateRuntime = getConvexCruxRuntime();
    });

    await expect(result).rejects.toThrow(/requires AsyncLocalStorage/);
    expect(synchronousRuntime).toBe(true);
    expect(lateRuntime).toBeUndefined();
    expect(getConvexCruxRuntime()).toBeUndefined();
  });

  it("keeps Convex, execution, observability, and Runtime-host facets active together", async () => {
    const records = inMemoryRecordStore();
    const convexRuntime = { ctx: {}, storage: { records }, records };
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const bound = new Error("bound Runtime host facet");
    const bind = vi.fn<RuntimeHostBinder>(() => {
      throw bound;
    });
    const definition = {
      kind: "host-bound",
      id: "test-host",
      host: "test-host",
      capabilities: {},
      entry: "testHost.run()",
    } as HostBoundRuntimeEngineDefinition;

    await runWithConvexCruxRuntime(convexRuntime, () =>
      runWithRuntimeHost({ host: "test-host", bind }, () =>
        runWithExecutionContext({ sessionId: "session-1" }, () =>
          observe.run(
            { name: "facet coexistence", rootPrimitive: "custom.operation" },
            async () => {
              await Promise.resolve();
              expect(getConvexCruxRuntime()).toBe(convexRuntime);
              expect(getExecutionContext()?.sessionId).toBe("session-1");
              expect(observe.captureContext()?.runId).toBeDefined();
              expect(() =>
                createRuntimeWithHostContext({
                  runtime: definition,
                  startMaintenance: false,
                }),
              ).toThrow(bound);
            },
          ),
        ),
      ),
    );

    expect(bind).toHaveBeenCalledOnce();
  });
});
