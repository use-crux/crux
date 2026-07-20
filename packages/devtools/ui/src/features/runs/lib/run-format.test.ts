import { describe, expect, it } from "vitest";
import {
  deliveryHealthTone,
  explainRunReliability,
  formatGraphCounts,
  graphCountsTitle,
  hasReliabilityDetail,
  isLiveStatus,
  reliabilityParts,
  reliabilityTone,
  statusTone,
} from "./run-format";
import type { RunRow } from "../types";

function row(overrides: Partial<RunRow> = {}): RunRow {
  return {
    kind: "trace",
    id: "run:r1",
    operationId: "r1",
    target: "r1",
    status: "ok",
    startedAt: 0,
    ...overrides,
  };
}

describe("run format helpers", () => {
  it("formats observability graph rollups for compact table cells", () => {
    const run = {
      kind: "trace",
      id: "run:1",
      operationId: "run:1",
      target: "run",
      status: "ok",
      startedAt: 1,
      recordCount: 100,
      spanCount: 7,
      eventCount: 42,
      artifactCount: 3,
      edgeCount: 2,
    } satisfies RunRow;

    expect(formatGraphCounts(run)).toBe("7 / 42 / 3 / 2");
    expect(graphCountsTitle(run)).toBe(
      "100 records · 7 spans · 42 events · 3 artifacts · 2 edges",
    );
  });
});

describe("statusTone", () => {
  it("distinguishes suspended (non-terminal pause) from a terminal status", () => {
    expect(statusTone("suspended")).not.toBe(statusTone("ok"));
    expect(statusTone("suspended")).not.toBe(statusTone("error"));
  });

  it("distinguishes incomplete (telemetry gap) from error", () => {
    expect(statusTone("incomplete")).not.toBe(statusTone("error"));
  });

  it("flags conflicted as needing attention, distinct from a clean cancel", () => {
    expect(statusTone("conflicted")).toBe("danger");
    expect(statusTone("cancelled")).not.toBe("danger");
  });

  it('only running is "live" — suspended is not', () => {
    expect(isLiveStatus("running")).toBe(true);
    expect(isLiveStatus("suspended")).toBe(false);
    expect(isLiveStatus("incomplete")).toBe(false);
  });
});

describe("deliveryHealthTone", () => {
  it("treats unknown as distinct from healthy, not a synonym for it", () => {
    expect(deliveryHealthTone("unknown")).not.toBe(
      deliveryHealthTone("healthy"),
    );
  });

  it("treats degraded as distinct from both unknown and healthy", () => {
    expect(deliveryHealthTone("degraded")).not.toBe(
      deliveryHealthTone("unknown"),
    );
    expect(deliveryHealthTone("degraded")).not.toBe(
      deliveryHealthTone("healthy"),
    );
  });

  it("falls back to muted when delivery health was never reported", () => {
    expect(deliveryHealthTone(undefined)).toBe("muted");
  });
});

describe("hasReliabilityDetail", () => {
  it("is calm for a normal single-segment run", () => {
    expect(
      hasReliabilityDetail(
        row({ segmentCount: 1, gapCount: 0, orderingConfidence: "causal" }),
      ),
    ).toBe(false);
  });

  it("flags a multi-segment run (suspend/resume across processes)", () => {
    expect(hasReliabilityDetail(row({ segmentCount: 2 }))).toBe(true);
  });

  it("flags sequence gaps and partial ordering", () => {
    expect(hasReliabilityDetail(row({ gapCount: 1 }))).toBe(true);
    expect(hasReliabilityDetail(row({ orderingConfidence: "partial" }))).toBe(
      true,
    );
  });

  it("flags a trace alias conflict and degraded delivery", () => {
    expect(hasReliabilityDetail(row({ traceAliasConflict: true }))).toBe(true);
    expect(hasReliabilityDetail(row({ deliveryHealth: "degraded" }))).toBe(
      true,
    );
  });

  it("stays calm when delivery health is merely unknown, not degraded", () => {
    expect(hasReliabilityDetail(row({ deliveryHealth: "unknown" }))).toBe(
      false,
    );
  });
});

describe("reliabilityParts / reliabilityTone", () => {
  it("lists each non-trivial signal as a terse fragment", () => {
    expect(
      reliabilityParts({
        segmentCount: 2,
        gapCount: 1,
        traceAliasConflict: true,
        orderingConfidence: "partial",
        deliveryHealth: "degraded",
      }),
    ).toEqual([
      "2 segments",
      "1 sequence gap",
      "conflicting trace alias",
      "partial ordering",
      "delivery degraded",
    ]);
  });

  it("reports no parts for a calm single-segment run", () => {
    expect(reliabilityParts({ segmentCount: 1, gapCount: 0 })).toEqual([]);
  });

  it("a trace alias conflict always wins the tone, even alongside degraded delivery", () => {
    expect(
      reliabilityTone({ traceAliasConflict: true, deliveryHealth: "degraded" }),
    ).toBe("danger");
  });

  it("degraded delivery without a conflict uses the shared deliveryHealthTone", () => {
    expect(reliabilityTone({ deliveryHealth: "degraded" })).toBe(
      deliveryHealthTone("degraded"),
    );
  });

  it("a calm run tones as crux", () => {
    expect(reliabilityTone({})).toBe("crux");
  });
});

describe("explainRunReliability", () => {
  it("explains a suspended run, mentioning segment count only when non-trivial", () => {
    expect(explainRunReliability({ status: "suspended" })).toBe(
      "This run is durably suspended, waiting on a signal, event, or timer.",
    );
    expect(
      explainRunReliability({ status: "suspended", segmentCount: 3 }),
    ).toBe(
      "This run is durably suspended, waiting on a signal, event, or timer. 3 execution segments have been observed so far.",
    );
  });

  it("explains an incomplete run, citing gap count when present", () => {
    expect(explainRunReliability({ status: "incomplete" })).toBe(
      "Telemetry ended without a run:end record — the run may still be executing out of view, or its process exited before reporting a terminal status.",
    );
    expect(
      explainRunReliability({ status: "incomplete", gapCount: 2 }),
    ).toContain("2 sequence gaps");
  });

  it("explains a conflicted run differently for a trace alias conflict vs. other terminal evidence conflicts", () => {
    expect(
      explainRunReliability({ status: "conflicted", traceAliasConflict: true }),
    ).toContain("trace alias");
    expect(explainRunReliability({ status: "conflicted" })).toContain(
      "stored terminal evidence",
    );
  });

  it("explains degraded delivery health, noting partial ordering when present", () => {
    expect(explainRunReliability({ deliveryHealth: "degraded" })).toContain(
      "degraded",
    );
    expect(
      explainRunReliability({
        deliveryHealth: "degraded",
        orderingConfidence: "partial",
      }),
    ).toContain("causal display order");
  });

  it("returns undefined for a calm, terminal, healthy run", () => {
    expect(
      explainRunReliability({ status: "ok", deliveryHealth: "healthy" }),
    ).toBeUndefined();
  });
});
