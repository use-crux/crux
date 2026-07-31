import { describe, expect, it } from "vitest";
import { pathFromState, stateFromPath } from "./useNavigation";

describe("Run Detail evidence navigation", () => {
  it("round-trips subject, role, record, and evidence tab", () => {
    const state = {
      view: "run-detail" as const,
      traceId: "trace_evidence",
      lens: "tree" as const,
      spanId: "span_subject",
      detailTab: "evidence" as const,
      evidenceRole: "verification" as const,
      evidenceId: "evidence_record",
    };
    const path =
      "/runs/trace_evidence?spanId=span_subject&tab=evidence&evidenceRole=verification&evidenceId=evidence_record";

    expect(pathFromState(state)).toBe(path);
    expect(
      stateFromPath(
        "/runs/trace_evidence",
        "?spanId=span_subject&tab=evidence&evidenceRole=verification&evidenceId=evidence_record",
      ),
    ).toEqual(state);
  });

  it("fails closed on unknown role/tab and oversized evidence ids", () => {
    expect(
      stateFromPath(
        "/runs/trace",
        `?tab=future&evidenceRole=future&evidenceId=${"x".repeat(513)}`,
      ),
    ).toEqual({
      view: "run-detail",
      traceId: "trace",
      lens: "tree",
    });
  });
});
