import { describe, expect, it } from "vitest";
import type { InspectRunRecord } from "@/types";
import { groupRuns } from "./run-groups";
import type { RunRow } from "../types";
import {
  annotateRunRowWithInspect,
  inspectAnnotationsByRunId,
  rowFromRunSummary,
  runsPageOptionsFromFilters,
} from "./run-mappers";

describe("runs row mapping", () => {
  it("maps deferred-work root primitives to the defer kind", async () => {
    const { canonicalPrimitiveKind } = await import("./run-mappers");
    expect(canonicalPrimitiveKind("defer.scheduled")).toBe("defer");
    expect(canonicalPrimitiveKind("defer.run")).toBe("defer");
  });

  it("uses observability list rollups, root session ids, and reliability fields directly", () => {
    const run = {
      runId: "run_live",
      operationId: "run_live",
      rootRunId: "run_live",
      rootPresent: true,
      firstSeenAt: "2026-07-03T10:00:00.000Z",
      childRunCount: 2,
      activeChildCount: 0,
      suspendedChildCount: 0,
      failedChildCount: 0,
      topologyHealth: "healthy",
      traceId: "trace_live",
      name: "streaming answer",
      rootPrimitive: "generation.call",
      status: "running",
      startedAt: "2026-07-03T10:00:00.000Z",
      endedAt: "",
      durationMs: 1234,
      model: "openai/gpt-4.1",
      provider: "openai",
      promptId: "support.reply",
      sessionId: "session_root",
      recordCount: 100,
      spanCount: 7,
      eventCount: 42,
      artifactCount: 3,
      edgeCount: 2,
      segmentCount: 2,
      activeSegmentId: "segment_2",
      orderingConfidence: "partial" as const,
      gapCount: 1,
      traceAliasConflict: false,
      revision: 42,
      deliveryHealth: { status: "degraded" as const, rejected: 3 },
      metrics: {
        totalTokens: 987,
        costUsd: 0.0123,
      },
      attributes: {
        sessionId: "stale_attribute_session",
      },
    };

    expect(rowFromRunSummary(run)).toMatchObject({
      operationId: "run_live",
      sessionId: "session_root",
      tokenCount: 987,
      cost: 0.0123,
      recordCount: 100,
      spanCount: 7,
      eventCount: 42,
      artifactCount: 3,
      edgeCount: 2,
      childCount: 2,
      segmentCount: 2,
      activeSegmentId: "segment_2",
      orderingConfidence: "partial",
      gapCount: 1,
      revision: 42,
      deliveryHealth: "degraded",
    });
  });

  it("annotates a canonical row with Inspect metadata without changing row identity", () => {
    const row = runRow("run-1", 100, undefined);

    const quality = {
      _tag: "InspectRun",
      operationId: "run-1",
      traceId: "run-1",
      targetId: "support reply",
      rootPrimitive: "generation.call",
      kind: "generation",
      status: "ok",
      startedAt: 1_775_000_000_000,
      model: "gpt-4o",
      provider: "openai",
      tokenCount: 42,
      toolCallCount: 2,
      spanCount: 3,
      childCount: 3,
      diagnosticsCount: 2,
      diagnosticsMaxSeverity: "warn",
    } satisfies InspectRunRecord;

    expect(annotateRunRowWithInspect(row, quality)).toMatchObject({
      operationId: "run-1",
      toolCallCount: 2,
      diagnosticsCount: 2,
      diagnosticsMaxSeverity: "warn",
    });
  });

  it("leaves a row unchanged when it has no matching Inspect annotation", () => {
    const row = runRow("run-unmatched", 100, undefined);
    expect(annotateRunRowWithInspect(row, undefined)).toEqual(row);
  });

  it("indexes Inspect annotations by explicit operationId", () => {
    const quality = {
      _tag: "InspectRun",
      operationId: "run-1",
      traceId: "run-1",
      status: "ok",
      startedAt: 1_775_000_000_000,
      toolCallCount: 0,
    } as InspectRunRecord;
    const byRunId = inspectAnnotationsByRunId([quality]);
    expect(byRunId.get("run-1")).toBe(quality);
    expect(byRunId.get("missing")).toBeUndefined();
  });

  it("maps status/time-range filters onto the server-side page request", () => {
    const opts = runsPageOptionsFromFilters({
      status: ["ok", "error"],
      last: "all",
    });
    expect(opts).toEqual({ status: ["ok", "error"], since: undefined });
  });

  it("reflects a live-to-terminal transition as the same row identity with an updated status", () => {
    const base = {
      runId: "run_transition",
      operationId: "run_transition",
      rootRunId: "run_transition",
      rootPresent: true,
      firstSeenAt: "2026-07-03T10:00:00.000Z",
      childRunCount: 0,
      activeChildCount: 0,
      suspendedChildCount: 0,
      failedChildCount: 0,
      topologyHealth: "healthy",
      traceId: "trace_transition",
      name: "answer",
      rootPrimitive: "generation.call",
      startedAt: "2026-07-03T10:00:00.000Z",
      endedAt: "",
      durationMs: 400,
      model: "openai/gpt-4.1",
      provider: "openai",
      promptId: "p",
      recordCount: 10,
      spanCount: 1,
      eventCount: 2,
      artifactCount: 0,
      edgeCount: 0,
      segmentCount: 1,
      orderingConfidence: "causal" as const,
      gapCount: 0,
      revision: 1,
    };

    const live = rowFromRunSummary({ ...base, status: "running", endedAt: "" });
    expect(live).toMatchObject({
      operationId: "run_transition",
      status: "running",
    });

    const terminal = rowFromRunSummary({
      ...base,
      status: "ok",
      endedAt: "2026-07-03T10:00:01.000Z",
      revision: 2,
    });
    expect(terminal).toMatchObject({
      operationId: "run_transition",
      status: "ok",
      revision: 2,
    });
    // Same operation row; only the lifecycle state advanced.
    expect(terminal.id).toBe(live.id);
    expect(terminal.operationId).toBe(live.operationId);
  });

  it("reflects suspend/resume as a multi-segment row without treating the pause as terminal", () => {
    const suspended = rowFromRunSummary({
      runId: "run_suspend",
      operationId: "run_suspend",
      rootRunId: "run_suspend",
      rootPresent: true,
      firstSeenAt: "2026-07-03T10:00:00.000Z",
      childRunCount: 0,
      activeChildCount: 0,
      suspendedChildCount: 0,
      failedChildCount: 0,
      topologyHealth: "healthy",
      traceId: "trace_suspend",
      name: "durable flow",
      rootPrimitive: "flow",
      status: "suspended",
      startedAt: "2026-07-03T10:00:00.000Z",
      endedAt: "",
      durationMs: 0,
      model: "",
      provider: "",
      promptId: "",
      recordCount: 5,
      spanCount: 1,
      eventCount: 1,
      artifactCount: 0,
      edgeCount: 0,
      segmentCount: 1,
      orderingConfidence: "causal",
      gapCount: 0,
      revision: 3,
    });
    expect(suspended.status).toBe("suspended");

    const resumed = rowFromRunSummary({
      runId: "run_suspend",
      operationId: "run_suspend",
      rootRunId: "run_suspend",
      rootPresent: true,
      firstSeenAt: "2026-07-03T10:00:00.000Z",
      childRunCount: 0,
      activeChildCount: 0,
      suspendedChildCount: 0,
      failedChildCount: 0,
      topologyHealth: "healthy",
      traceId: "trace_suspend",
      name: "durable flow",
      rootPrimitive: "flow",
      status: "running",
      startedAt: "2026-07-03T10:00:00.000Z",
      endedAt: "",
      durationMs: 0,
      model: "",
      provider: "",
      promptId: "",
      recordCount: 8,
      spanCount: 2,
      eventCount: 2,
      artifactCount: 0,
      edgeCount: 0,
      segmentCount: 2,
      activeSegmentId: "segment_2",
      orderingConfidence: "causal",
      gapCount: 0,
      revision: 4,
    });
    expect(resumed).toMatchObject({
      status: "running",
      segmentCount: 2,
      activeSegmentId: "segment_2",
    });
  });

  it("does not let late stream metadata change the already-committed duration or status", () => {
    // A generation's span duration is fixed at its stream-terminal signal
    // (binding spec 04/09). Late usage metadata that arrives afterward is
    // linked telemetry, not a mutation of the row's timing/status.
    const summaryBase = {
      runId: "run_late",
      operationId: "run_late",
      rootRunId: "run_late",
      rootPresent: true,
      firstSeenAt: "2026-07-03T10:00:00.000Z",
      childRunCount: 0,
      activeChildCount: 0,
      suspendedChildCount: 0,
      failedChildCount: 0,
      topologyHealth: "healthy",
      traceId: "trace_late",
      name: "stream",
      rootPrimitive: "generation.call",
      status: "ok" as const,
      startedAt: "2026-07-03T10:00:00.000Z",
      endedAt: "2026-07-03T10:00:02.000Z",
      durationMs: 2000,
      model: "openai/gpt-4.1",
      provider: "openai",
      promptId: "p",
      recordCount: 20,
      spanCount: 1,
      eventCount: 5,
      artifactCount: 0,
      edgeCount: 0,
      segmentCount: 1,
      orderingConfidence: "causal" as const,
      gapCount: 0,
    };

    const withoutLateUsage = rowFromRunSummary({
      ...summaryBase,
      revision: 5,
      metrics: { totalTokens: 100 },
    });
    const withLateUsage = rowFromRunSummary({
      ...summaryBase,
      recordCount: 21, // late token-chunk record landed
      revision: 6,
      metrics: { totalTokens: 140 }, // usage revised upward by a late chunk
    });

    expect(withLateUsage.durationMs).toBe(withoutLateUsage.durationMs);
    expect(withLateUsage.status).toBe(withoutLateUsage.status);
    expect(withLateUsage.tokenCount).toBe(140);
  });

  it('renders "unknown" delivery health as distinct from "healthy", not defaulted to it', () => {
    const unknown = rowFromRunSummary({
      runId: "run_health_unknown",
      operationId: "run_health_unknown",
      rootRunId: "run_health_unknown",
      rootPresent: true,
      firstSeenAt: "2026-07-03T10:00:00.000Z",
      childRunCount: 0,
      activeChildCount: 0,
      suspendedChildCount: 0,
      failedChildCount: 0,
      topologyHealth: "healthy",
      traceId: "trace_health_unknown",
      name: "r",
      rootPrimitive: "generation.call",
      status: "ok",
      startedAt: "2026-07-03T10:00:00.000Z",
      endedAt: "2026-07-03T10:00:01.000Z",
      durationMs: 1000,
      model: "",
      provider: "",
      promptId: "",
      recordCount: 1,
      spanCount: 1,
      eventCount: 0,
      artifactCount: 0,
      edgeCount: 0,
      segmentCount: 1,
      orderingConfidence: "causal",
      gapCount: 0,
      revision: 1,
      deliveryHealth: { status: "unknown" },
    });
    const noHealthReported = rowFromRunSummary({
      runId: "run_health_none",
      operationId: "run_health_none",
      rootRunId: "run_health_none",
      rootPresent: true,
      firstSeenAt: "2026-07-03T10:00:00.000Z",
      childRunCount: 0,
      activeChildCount: 0,
      suspendedChildCount: 0,
      failedChildCount: 0,
      topologyHealth: "healthy",
      traceId: "trace_health_none",
      name: "r",
      rootPrimitive: "generation.call",
      status: "ok",
      startedAt: "2026-07-03T10:00:00.000Z",
      endedAt: "2026-07-03T10:00:01.000Z",
      durationMs: 1000,
      model: "",
      provider: "",
      promptId: "",
      recordCount: 1,
      spanCount: 1,
      eventCount: 0,
      artifactCount: 0,
      edgeCount: 0,
      segmentCount: 1,
      orderingConfidence: "causal",
      gapCount: 0,
      revision: 1,
    });

    expect(unknown.deliveryHealth).toBe("unknown");
    expect(unknown.deliveryHealth).not.toBe("healthy");
    expect(noHealthReported.deliveryHealth).toBeUndefined();
  });

  it("groups sessions newest first and keeps newest runs first inside each session", () => {
    const rows = [
      runRow("old-a", 100, "session-a"),
      runRow("new-b", 500, "session-b"),
      runRow("new-a", 900, "session-a"),
      runRow("old-b", 200, "session-b"),
      runRow("ungrouped", 700, undefined),
    ];

    const groups = groupRuns(rows, "session");

    expect(groups.map((group) => group.key)).toEqual([
      "session-a",
      "-",
      "session-b",
    ]);
    expect(groups[0]!.rows.map((run) => run.operationId)).toEqual([
      "new-a",
      "old-a",
    ]);
    expect(groups[2]!.rows.map((run) => run.operationId)).toEqual([
      "new-b",
      "old-b",
    ]);
  });
});

function runRow(
	operationId: string,
  startedAt: number,
  sessionId: string | undefined,
): RunRow {
  return {
    kind: "trace",
    id: `operation:${operationId}`,
    operationId,
    target: operationId,
    sessionId,
    status: "ok",
    startedAt,
  };
}
