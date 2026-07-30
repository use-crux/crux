import { afterEach, describe, expect, it } from "vitest";
import { evidence } from "@use-crux/core";
import {
  observe,
  resetObservabilityRuntime,
  type CruxGraphRecord,
} from "@use-crux/core/observability";

import { withTelemetry } from "../src";
import {
  evidenceCoverageEventProjection,
  evidenceEventProjection,
} from "../src/evidence-events";
import type { TraceSpan } from "../src/types";

describe("dedicated evidence OTel events", () => {
  afterEach(() => resetObservabilityRuntime());

  it("exports a qualified relationship through only the closed evidence event", async () => {
    const spans: TraceSpan[] = [];
    const installed = withTelemetry({
      exporter: (batch) => {
        spans.push(...batch);
      },
    }).install({});

    await observe.span(
      { name: "verify", primitive: "constraint.check" },
      async () => {
        evidence.record({
          role: "verification",
          kind: "custom.private-review-name",
          conclusion: "passed",
          data: { secret: "INLINE-EVIDENCE-SECRET" },
        });
      },
    );
    installed.dispose?.();

    const serialized = JSON.stringify(spans);
    const event = spans
      .flatMap((span) => span.events ?? [])
      .find((candidate) => candidate.name === "crux.evidence");

    expect(event?.attributes).toEqual({
      "crux.evidence.id": expect.stringMatching(/^evidence_[0-9a-f]{16,64}$/),
      "crux.evidence.role": "verification",
      "crux.evidence.kind": "custom",
      "crux.evidence.conclusion": "passed",
      "crux.evidence.subject_kind": "span",
    });
    expect(
      spans
        .flatMap((span) => span.events ?? [])
        .some(
          (candidate) =>
            candidate.name === "crux.edge" &&
            candidate.attributes?.["crux.edge.type"] === "evidence.for",
        ),
    ).toBe(false);
    expect(serialized).not.toContain("custom.private-review-name");
    expect(serialized).not.toContain("INLINE-EVIDENCE-SECRET");
    expect(serialized).not.toContain("contentDigest");
    expect(serialized).not.toContain("idempotencyKeyHash");
    expect(serialized).not.toContain("evidenceSource");
  });

  it.each([
    ["intent", undefined],
    ["authority", "allowed"],
    ["change", "applied"],
    ["verification", "passed"],
    ["recovery", "succeeded"],
  ] as const)("projects the closed %s role/conclusion pair", (role, conclusion) => {
    expect(
      evidenceEventProjection(
        evidenceEdge({
          attributes: { role, conclusion },
        }),
      )?.attributes,
    ).toEqual({
      "crux.evidence.id": "evidence_3333333333333333",
      "crux.evidence.role": role,
      "crux.evidence.kind": "score.report",
      ...(conclusion
        ? { "crux.evidence.conclusion": conclusion }
        : {}),
      "crux.evidence.subject_kind": "span",
    });
  });

  it.each([
    [{ kind: "run", id: "run_subject" }, "run"],
    [{ kind: "span", id: "4444444444444444" }, "span"],
    [{ kind: "artifact", id: "artifact_5555555555555555" }, "artifact"],
  ] as const)("derives the validated %s subject kind", (subject, expected) => {
    expect(
      evidenceEventProjection(evidenceEdge({ to: subject }))?.attributes[
        "crux.evidence.subject_kind"
      ],
    ).toBe(expected);
  });

  it("fails closed on effect receipts until #196 supplies a canonical graph subject", () => {
    expect(
      evidenceEventProjection(
        evidenceEdge({
          to: {
            kind: "effect.receipt",
            id: "receipt_1",
            effectId: "effect_1",
          },
        }),
      ),
    ).toBeUndefined();
  });

  it("validates evidence ID boundaries and fails closed on future fields", () => {
    for (const length of [16, 64]) {
      expect(
        evidenceEventProjection(
          evidenceEdge({
            attributes: { evidenceId: `evidence_${"a".repeat(length)}` },
          }),
        ),
      ).toBeDefined();
    }
    for (const length of [15, 65]) {
      expect(
        evidenceEventProjection(
          evidenceEdge({
            attributes: { evidenceId: `evidence_${"a".repeat(length)}` },
          }),
        ),
      ).toBeUndefined();
    }
    expect(
      evidenceEventProjection(
        evidenceEdge({
          attributes: { futureSecret: "FUTURE-QUALIFIED-SECRET" },
        }),
      ),
    ).toBeUndefined();
  });

  it.each([
    ["not-configured"],
    ["not-applicable"],
    ["not-captured"],
    ["redacted"],
  ] as const)("projects the closed %s coverage status", (status) => {
    expect(
      evidenceCoverageEventProjection(coverageEvent({ status })),
    ).toEqual({
      name: "crux.evidence.coverage",
      attributes: {
        "crux.evidence.role": "verification",
        "crux.evidence.coverage_status": status,
      },
    });
  });

  it("projects conflicts separately and drops malformed coverage", () => {
    expect(
      evidenceCoverageEventProjection(
        coverageEvent(undefined, "evidence.coverage.conflict"),
      ),
    ).toEqual({
      name: "crux.evidence.coverage.conflict",
      attributes: { "crux.evidence.role": "verification" },
    });
    expect(
      evidenceCoverageEventProjection(
        coverageEvent({ futureSecret: "PRIVATE" }),
      ),
    ).toBeUndefined();
  });

  it("routes qualified coverage through dedicated event names", async () => {
    const spans: TraceSpan[] = [];
    const installed = withTelemetry({
      exporter(batch) {
        spans.push(...batch);
      },
    }).install({});

    await observe.span(
      { name: "coverage", primitive: "constraint.check" },
      async () => {
        observe.event({
          name: "evidence.coverage",
          attributes: {
            subject: { kind: "span", id: "2222222222222222" },
            role: "verification",
            status: "not-configured",
          },
        });
        observe.event({
          name: "evidence.coverage.conflict",
          attributes: { role: "verification" },
        });
      },
    );
    installed.dispose?.();

    const events = spans.flatMap((span) => span.events ?? []);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "crux.evidence.coverage",
          attributes: {
            "crux.evidence.role": "verification",
            "crux.evidence.coverage_status": "not-configured",
          },
        }),
        expect.objectContaining({
          name: "crux.evidence.coverage.conflict",
          attributes: { "crux.evidence.role": "verification" },
        }),
      ]),
    );
    expect(events.some((event) => event.name === "evidence.coverage")).toBe(
      false,
    );
  });
});

function evidenceEdge(options: {
  readonly to?: unknown;
  readonly attributes?: Readonly<Record<string, unknown>>;
} = {}): CruxGraphRecord {
  return {
    schemaVersion: 5,
    recordId: "rec_evidence_edge",
    type: "edge",
    operationId: "run_evidence",
    runId: "run_evidence",
    segmentId: "seg_evidence",
    segmentSeq: 1,
    edgeId: "edge_evidence",
    edgeType: "evidence.for",
    from: { kind: "artifact", id: "artifact_1111111111111111" },
    to: options.to ?? { kind: "span", id: "2222222222222222" },
    createdAt: "2026-07-30T00:00:00.000Z",
    attributes: {
      evidenceId: "evidence_3333333333333333",
      role: "verification",
      evidenceKind: "score.report",
      conclusion: "passed",
      recordedAt: "2026-07-30T00:00:00.000Z",
      producer: { kind: "span", id: "6666666666666666" },
      captureState: "reference",
      sourceMode: "reference",
      ...options.attributes,
    },
  } as unknown as CruxGraphRecord;
}

function coverageEvent(
  attributes?: Readonly<Record<string, unknown>>,
  name = "evidence.coverage",
): CruxGraphRecord {
  const supplemental =
    attributes ??
    (name === "evidence.coverage" ? { status: "not-configured" } : {});
  return {
    schemaVersion: 5,
    recordId: "rec_evidence_coverage",
    type: "span:event",
    operationId: "run_evidence",
    runId: "run_evidence",
    segmentId: "seg_evidence",
    segmentSeq: 2,
    spanId: "6666666666666666",
    eventId: "event_evidence_coverage",
    name,
    timestamp: "2026-07-30T00:00:00.000Z",
    attributes: {
      ...(name === "evidence.coverage"
        ? {
            subject: { kind: "span", id: "2222222222222222" },
            status: "not-configured",
          }
        : {}),
      role: "verification",
      ...supplemental,
    },
  } as unknown as CruxGraphRecord;
}
