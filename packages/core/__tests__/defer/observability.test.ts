import { afterEach, describe, expect, it, vi } from "vitest";
import { defer } from "@use-crux/core";
import {
  runWithDeferInvocation,
  type DeferLifetimeCapability,
} from "@use-crux/core/internal/defer-host";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
  type CruxGraphRecord,
} from "../../src/observability";
import { expectBalancedGraph } from "../observability/helpers/expect-balanced-graph";
import { testLifetime } from "./test-lifetime";
import { scheduleDiagnosticsOnlyDeferredCallback } from "../../src/defer/internal/port";

describe("public defer observability (DFR-E04)", () => {
  afterEach(() => {
    resetObservabilityRuntime();
  });

  it("emits defer.scheduled then defer.run under the originating run with a causal triggered edge", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    let scheduled: (() => Promise<void>) | undefined;
    await observe.run(
      { name: "handler", rootPrimitive: "custom.operation" },
      async () => {
        await runWithDeferInvocation(
          () => {
            defer(async () => {});
            return "ok";
          },
          {
            lifetime: testLifetime((run) => {
              scheduled = run;
            }),
            classifyOutcome: () => "success",
          },
        );
      },
    );

    expect(scheduled).toBeTypeOf("function");
    await scheduled?.();
    await observe.flush();

    const records = transport.records;
    expectBalancedGraph(records);

    const scheduledStart = records.find(
      (record): record is Extract<CruxGraphRecord, { type: "span:start" }> =>
        record.type === "span:start" && record.primitive === "defer.scheduled",
    );
    expect(scheduledStart).toMatchObject({
      family: "defer",
      primitive: "defer.scheduled",
      attributes: expect.objectContaining({
        mode: "inline",
        completion: "handler-returned",
        sequence: 0,
      }),
    });

    const runStart = records.find(
      (record): record is Extract<CruxGraphRecord, { type: "span:start" }> =>
        record.type === "span:start" && record.primitive === "defer.run",
    );
    expect(runStart).toMatchObject({
      family: "defer",
      primitive: "defer.run",
      parentSpanId: null,
      attributes: expect.objectContaining({
        mode: "inline",
        completion: "handler-returned",
        sequence: 0,
      }),
    });

    expect(records).toContainEqual(
      expect.objectContaining({
        type: "edge",
        edgeType: "triggered",
        from: { kind: "span", id: scheduledStart?.spanId },
        to: { kind: "span", id: runStart?.spanId },
      }),
    );

    const originatingRun = records.find(
      (record) =>
        record.type === "run:start" &&
        record.rootPrimitive === "custom.operation",
    );
    expect(originatingRun).toBeDefined();
    expect(scheduledStart?.runId).toBe(originatingRun && "runId" in originatingRun ? originatingRun.runId : undefined);
    expect(runStart?.runId).toBe(scheduledStart?.runId);
  });

  it("creates one lightweight grouped deferred-work run when no originating Crux run exists", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    let scheduled: (() => Promise<void>) | undefined;
    await runWithDeferInvocation(
      () => {
        defer(async () => {});
        defer(async () => {});
        return "ok";
      },
      {
        lifetime: testLifetime((run) => {
          scheduled = run;
        }),
        classifyOutcome: () => "success",
      },
    );

    await scheduled?.();
    await observe.flush();

    const runStarts = transport.records.filter(
      (record) => record.type === "run:start",
    );
    expect(runStarts).toHaveLength(1);
    expect(runStarts[0]).toMatchObject({
      rootPrimitive: "defer.scheduled",
      name: "deferred work",
    });

    const scheduledSpans = transport.records.filter(
      (record) =>
        record.type === "span:start" && record.primitive === "defer.scheduled",
    );
    expect(scheduledSpans).toHaveLength(2);
    expect(new Set(scheduledSpans.map((span) => span.runId)).size).toBe(1);

    expectBalancedGraph(transport.records);
  });

  it("records contained callback failure without unbalancing the graph", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    let scheduled: (() => Promise<void>) | undefined;
    await runWithDeferInvocation(
      () => {
        defer(async () => {
          throw new Error("callback boom");
        });
        return "ok";
      },
      {
        lifetime: testLifetime((run) => {
          scheduled = run;
        }),
        classifyOutcome: () => "success",
      },
    );

    await scheduled?.();
    await observe.flush();

    const runEnd = transport.records.find(
      (record) =>
        record.type === "span:end" &&
        transport.records.some(
          (start) =>
            start.type === "span:start" &&
            start.spanId === record.spanId &&
            start.primitive === "defer.run",
        ),
    );
    expect(runEnd).toMatchObject({
      status: "error",
      error: expect.objectContaining({
        category: "DEFER_CALLBACK_FAILED",
        message: expect.stringContaining("deferred callback failed"),
      }),
    });
    expectBalancedGraph(transport.records);
  });
});

describe("internal defer composition is quiet (DFR-E03)", () => {
  afterEach(() => {
    resetObservabilityRuntime();
  });

  it("does not emit Catalog or user Run/scheduled spans for diagnostics-only scheduling", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    let scheduled: (() => Promise<void>) | undefined;
    await observe.run(
      { name: "owner", rootPrimitive: "custom.operation" },
      async () => {
        await runWithDeferInvocation(
          () => {
            scheduleDiagnosticsOnlyDeferredCallback(async () => {});
            return "ok";
          },
          {
            lifetime: testLifetime((run) => {
              scheduled = run;
            }),
            classifyOutcome: () => "success",
          },
        );
      },
    );

    await scheduled?.();
    await observe.flush();

    expect(
      transport.records.filter(
        (record) =>
          record.type === "span:start" &&
          (record.primitive === "defer.scheduled" ||
            record.primitive === "defer.run"),
      ),
    ).toHaveLength(0);
    expect(
      transport.records.filter(
        (record) =>
          record.type === "run:start" &&
          record.rootPrimitive === "defer.scheduled",
      ),
    ).toHaveLength(0);
  });
});

describe("handler-returned completion class is recorded", () => {
  afterEach(() => {
    resetObservabilityRuntime();
  });

  it("stamps completion on scheduled and run attributes", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    let scheduled: (() => Promise<void>) | undefined;
    const lifetime: DeferLifetimeCapability = {
      ...testLifetime((run) => {
        scheduled = run;
      }),
      completion: "response-finished",
    };

    await runWithDeferInvocation(
      () => {
        defer(() => {});
        return "ok";
      },
      {
        lifetime,
        classifyOutcome: () => "success",
      },
    );
    await scheduled?.();
    await observe.flush();

    for (const primitive of ["defer.scheduled", "defer.run"] as const) {
      expect(transport.records).toContainEqual(
        expect.objectContaining({
          type: "span:start",
          primitive,
          attributes: expect.objectContaining({
            completion: "response-finished",
          }),
        }),
      );
    }
  });
});
