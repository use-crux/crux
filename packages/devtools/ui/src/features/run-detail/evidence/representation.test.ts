import { describe, expect, it } from "vitest";
import {
  evidenceRendererForKind,
  shouldRenderGenericEvidence,
} from "./representation";
import { projectRelatedEvidence } from "./related-evidence";

describe("Evidence presentation ownership", () => {
  it.each([
    ["tool.args", "tool"],
    ["approval.decision", "approval"],
    ["memory.snapshot", "memory"],
    ["retrieval.hits", "retrieval"],
    ["guardrail.report", "safety"],
    ["score.report", "evaluation"],
    ["media.report", "media"],
    ["custom.review", "generic"],
  ] as const)("maps %s to the %s renderer", (kind, renderer) => {
    expect(evidenceRendererForKind(kind).id).toBe(renderer);
  });

  it("suppresses a generic duplicate only when panel representation is proven", () => {
    const key = "span:subject:evidence_1";
    expect(
      shouldRenderGenericEvidence({
        surface: "generic-collection",
        key,
        representedKeys: new Set([key]),
      }),
    ).toBe(false);
    expect(
      shouldRenderGenericEvidence({
        surface: "generic-collection",
        key,
        representedKeys: new Set(),
      }),
    ).toBe(true);
    expect(
      shouldRenderGenericEvidence({
        surface: "generic-collection",
        key,
        representedKeys: new Set(),
        pagedOutKeys: new Set([key]),
        honestRemainingCount: 2,
      }),
    ).toBe(false);
    expect(
      shouldRenderGenericEvidence({
        surface: "generic-collection",
        key,
        representedKeys: new Set(),
        pagedOutKeys: new Set([key]),
      }),
    ).toBe(true);
  });

  it.each(["graph", "story", "raw", "share", "json"] as const)(
    "never suppresses the %s surface",
    (surface) => {
      expect(
        shouldRenderGenericEvidence({
          surface,
          key: "span:subject:evidence_1",
          representedKeys: new Set(["span:subject:evidence_1"]),
        }),
      ).toBe(true);
    },
  );
});

describe("Related Evidence structural projection", () => {
  const tree = {
    id: "span_root",
    spanId: "span_root",
    name: "Root",
    children: [
      {
        id: "span_first",
        spanId: "span_first",
        name: "First",
        children: [
          {
            id: "span_nested",
            spanId: "span_nested",
            name: "Nested",
            children: [],
          },
        ],
      },
      {
        id: "span_second",
        spanId: "span_second",
        name: "Second",
        children: [],
      },
    ],
  };

  it("uses deterministic structural order, exact totals, and no role merging", () => {
    expect(
      projectRelatedEvidence({
        root: tree,
        selectedId: "span_root",
        countsBySubject: new Map([
          ["execution:span_first", 2],
          ["execution:span_nested", 1],
          ["execution:span_second", 4],
        ]),
        limit: 2,
      }),
    ).toEqual({
      total: 3,
      showing: 2,
      rows: [
        {
          subject: { kind: "execution", id: "span_first" },
          label: "First",
          kind: "span",
          recordCount: 2,
        },
        {
          subject: { kind: "execution", id: "span_nested" },
          label: "Nested",
          kind: "span",
          recordCount: 1,
        },
      ],
    });
  });

  it("never follows producer-like nodes outside the selected subtree", () => {
    expect(
      projectRelatedEvidence({
        root: tree,
        selectedId: "span_first",
        countsBySubject: new Map([
          ["execution:span_root", 9],
          ["execution:span_nested", 1],
          ["execution:external_producer", 5],
        ]),
        limit: 10,
      }),
    ).toEqual({
      total: 1,
      showing: 1,
      rows: [
        {
          subject: { kind: "execution", id: "span_nested" },
          label: "Nested",
          kind: "span",
          recordCount: 1,
        },
      ],
    });
  });

  it("counts one canonical subject once when structure repeats it", () => {
    expect(
      projectRelatedEvidence({
        root: {
          id: "span_root",
          spanId: "span_root",
          name: "Root",
          children: [
            {
              id: "presentation_first",
              spanId: "span_shared",
              name: "First label",
              children: [],
            },
            {
              id: "presentation_second",
              spanId: "span_shared",
              name: "Repeated label",
              children: [],
            },
          ],
        },
        selectedId: "span_root",
        countsBySubject: new Map([["execution:span_shared", 3]]),
        limit: 10,
      }),
    ).toEqual({
      total: 1,
      showing: 1,
      rows: [
        {
          subject: { kind: "execution", id: "span_shared" },
          label: "First label",
          kind: "span",
          recordCount: 3,
        },
      ],
    });
  });
});
