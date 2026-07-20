import { describe, expect, it } from "vitest";
import type { ObservabilityRunSummary } from "@/types";
import { searchRuns } from "./search-runs";

function run(
  partial: Partial<ObservabilityRunSummary> &
    Pick<ObservabilityRunSummary, "runId">,
): ObservabilityRunSummary {
  return {
    runId: partial.runId,
    operationId: partial.operationId ?? partial.runId,
    rootRunId: partial.rootRunId ?? partial.runId,
    rootPresent: partial.rootPresent ?? true,
    firstSeenAt: partial.firstSeenAt ?? "2026-07-01T00:00:00.000Z",
    childRunCount: partial.childRunCount ?? 0,
    activeChildCount: partial.activeChildCount ?? 0,
    suspendedChildCount: partial.suspendedChildCount ?? 0,
    failedChildCount: partial.failedChildCount ?? 0,
    topologyHealth: partial.topologyHealth ?? "healthy",
    traceId: partial.traceId ?? partial.runId,
    name: partial.name ?? "run",
    rootPrimitive: partial.rootPrimitive ?? "agent.run",
    status: partial.status ?? "ok",
    startedAt: partial.startedAt ?? "2026-07-01T00:00:00.000Z",
    endedAt: partial.endedAt ?? "2026-07-01T00:00:01.000Z",
    durationMs: partial.durationMs ?? 1,
    model: partial.model ?? "gpt-test",
    provider: partial.provider ?? "test",
    promptId: partial.promptId ?? "",
    recordCount: partial.recordCount ?? 1,
    spanCount: partial.spanCount ?? 1,
    eventCount: partial.eventCount ?? 0,
    artifactCount: partial.artifactCount ?? 0,
    edgeCount: partial.edgeCount ?? 0,
    segmentCount: partial.segmentCount ?? 1,
    orderingConfidence: partial.orderingConfidence ?? "causal",
    gapCount: partial.gapCount ?? 0,
    revision: partial.revision ?? 1,
  };
}

describe("searchRuns", () => {
  it("matches revisioned Runs-page rows by id, name, model, and prompt", () => {
    const rows = [
      run({
        runId: "run_alpha",
        name: "greeter",
        promptId: "prompt:hello",
        model: "gpt-test",
      }),
      run({
        runId: "run_beta",
        name: "other",
        rootPrimitive: "flow.run",
        model: "claude-test",
      }),
    ];

    expect(searchRuns(rows, "hello").map((r) => r.id)).toEqual(["run_alpha"]);
    expect(searchRuns(rows, "gpt-test").map((r) => r.id)).toEqual([
      "run_alpha",
    ]);
    expect(searchRuns(rows, "flow.run").map((r) => r.id)).toEqual(["run_beta"]);
  });

  it("caps results and navigates to run-detail by operation id", () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      run({
        runId: `operation_${i}`,
        operationId: `operation_${i}`,
        name: `match-${i}`,
      }),
    );
    const results = searchRuns(rows, "match");
    expect(results).toHaveLength(5);
    expect(results[0]?.nav).toEqual({
      view: "run-detail",
      traceId: "operation_0",
    });
  });
});
