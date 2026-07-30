import { describe, expect, it } from "vitest";
import type { ObservabilityRunDetail } from "@/types";
import {
  evidenceSubjectForSelection,
  resolveEvidenceNavigation,
  resolveEvidenceNavigationTarget,
} from "./EvidenceSubjectPanel";

const detail = {
  run: { runId: "run_current", traceId: "trace_current" },
  root: {
    id: "presentation_root",
    kind: "eval",
    spanId: "span_root",
    children: [
      {
        id: "presentation_child",
        kind: "generation",
        spanId: "span_child",
        children: [],
      },
    ],
  },
} as unknown as ObservabilityRunDetail;

describe("EvidenceSubjectPanel exact identities", () => {
  it("uses the canonical run subject for the presentation root", () => {
    expect(evidenceSubjectForSelection(detail, null)).toEqual({
      kind: "execution",
      id: "run_current",
    });
    expect(
      evidenceSubjectForSelection(detail, "presentation_root"),
    ).toEqual({
      kind: "execution",
      id: "run_current",
    });
    expect(
      evidenceSubjectForSelection(detail, "presentation_child"),
    ).toEqual({
      kind: "execution",
      id: "span_child",
    });
    expect(evidenceSubjectForSelection(detail, "span_root")).toEqual({
      kind: "execution",
      id: "span_root",
    });
  });

  it("navigates only identities proven by the loaded run model", () => {
    expect(
      resolveEvidenceNavigation(detail, "trace_current", {
        kind: "execution",
        id: "run_current",
      }),
    ).toEqual({
      view: "run-detail",
      traceId: "trace_current",
      lens: "tree",
    });
    expect(
      resolveEvidenceNavigation(detail, "trace_current", {
        kind: "execution",
        id: "span_child",
      }),
    ).toEqual({
      view: "run-detail",
      traceId: "trace_current",
      lens: "tree",
      spanId: "presentation_child",
    });
    expect(
      resolveEvidenceNavigation(detail, "trace_current", {
        kind: "execution",
        id: "run_retained_elsewhere",
      }),
    ).toBeUndefined();
    expect(
      resolveEvidenceNavigation(detail, "trace_current", {
        kind: "artifact",
        id: "artifact_without_exact_route",
      }),
    ).toBeUndefined();
  });

  it("uses the exact persisted run identity as the Run Detail route key", () => {
    expect(
      resolveEvidenceNavigationTarget({
        kind: "span",
        spanId: "span_retained",
        runId: "run_retained",
        traceId: "trace_retained",
        retainedDefinitionRefs: [],
      }),
    ).toEqual({
      view: "run-detail",
      traceId: "run_retained",
      lens: "tree",
      spanId: "span_retained",
    });
  });
});
