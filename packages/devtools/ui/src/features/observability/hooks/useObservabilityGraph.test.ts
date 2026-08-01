import { describe, expect, it } from "vitest";
import type { ObservabilityRunDetailNode } from "@/types";
import {
  nodeFromRunDetail,
  observabilityRunRefetchInterval,
} from "./useObservabilityGraph";

describe("observability run polling", () => {
  it("stops after Local proves that a run does not exist", () => {
    expect(
      observabilityRunRefetchInterval({
        state: { data: null, dataUpdatedAt: Date.now() },
      }),
    ).toBe(false);
  });
});

function retrievalStepNode(
  fields: Partial<ObservabilityRunDetailNode>,
): ObservabilityRunDetailNode {
  return {
    id: "node:retrieval.step",
    spanId: "span:retrieval.step",
    runId: "run:1",
    traceId: "trace:1",
    parentSpanId: "",
    family: "retrieval",
    primitive: "retrieval.step",
    name: "plan:expandDocs",
    status: "ok",
    startedAt: "2026-07-31T00:00:00.000Z",
    endedAt: "2026-07-31T00:00:00.010Z",
    durationMs: 10,
    model: "",
    provider: "",
    virtual: false,
    parentId: "",
    path: [],
    kind: "retrieval",
    display: { kind: "step", label: "retrieval.step" },
    timing: {
      startedAt: "2026-07-31T00:00:00.000Z",
      endedAt: "2026-07-31T00:00:00.010Z",
      durationMs: 10,
    },
    metricBuckets: {},
    source: {},
    details: [],
    artifacts: [],
    events: [],
    relations: [],
    diagnostics: [],
    children: [],
    ...fields,
  } as ObservabilityRunDetailNode;
}

describe("run detail retrieval step labels", () => {
  it("uses stepKind for Connected Knowledge retrieval step rows", () => {
    expect(
      nodeFromRunDetail(
        retrievalStepNode({
          stepId: "expandDocs",
          attributes: {
            stepKind: "expand-relations",
            kind: "expand-relations",
            stepId: "expandDocs",
          },
        }),
      ).label,
    ).toBe("Expand relations · expandDocs");

    expect(
      nodeFromRunDetail(
        retrievalStepNode({
          name: "search:global",
          display: { kind: "step", label: "search:global" },
          attributes: {
            stepKind: "global-search",
            kind: "global-search",
            stepId: "global",
          },
        }),
      ).label,
    ).toBe("Global search · global");
  });

  it("keeps specific backend display labels", () => {
    expect(
      nodeFromRunDetail(
        retrievalStepNode({
          display: { kind: "step", label: "Published document search" },
          attributes: { stepKind: "global-search", stepId: "global" },
        }),
      ).label,
    ).toBe("Published document search");
  });
});
