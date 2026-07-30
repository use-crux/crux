import { describe, expect, it } from "vitest";
import {
  evidencePayloadPresentation,
  evidenceStatusPresentation,
  projectEvidenceRole,
  projectEvidenceRecord,
} from "./presentation";
import type {
  EvidenceApiRecord,
  EvidenceApiRoleResult,
} from "./types";

describe("Run Detail evidence presentation", () => {
  it.each([
    ["present", "Evidence present"],
    ["not-yet-recorded", "No evidence recorded yet"],
    ["not-configured", "Native producer not configured"],
    ["not-applicable", "This role does not apply"],
    ["not-captured", "Not captured by the producer"],
    ["redacted", "Payload unavailable"],
  ] as const)("renders %s as %s", (status, label) => {
    expect(evidenceStatusPresentation(status)).toMatchObject({ label });
  });

  it.each([
    ["available", undefined, "Payload available"],
    ["reference", undefined, "Payload not retained here"],
    ["not-captured", undefined, "Not captured by the producer"],
    ["redacted", "policy", "Removed by policy"],
    ["redacted", "retention", "Payload expired"],
    ["redacted", "access", "Unavailable with this access"],
    ["redacted", undefined, "Payload unavailable"],
  ] as const)("renders %s/%s payloads honestly", (state, reason, label) => {
    expect(evidencePayloadPresentation(state, reason)).toEqual(label);
  });

  it("keeps complete conflict, conclusion, history, truncation, and pagination aggregates", () => {
    const role: EvidenceApiRoleResult<"verification"> = {
      role: "verification",
      status: "present",
      activeRecordCount: 1,
      records: [record("evidence_active", "passed")],
      history: [record("evidence_history", "failed")],
      conclusion: "passed",
      conflicting: false,
      truncated: true,
      cursor: "opaque-cursor",
    };

    expect(projectEvidenceRole(role)).toMatchObject({
      role: "verification",
      label: "Verification",
      status: {
        value: "present",
        label: "Evidence present",
      },
      conclusion: "passed",
      conflicting: false,
      truncated: true,
      cursor: "opaque-cursor",
      records: [{ id: "evidence_active" }],
      history: [{ id: "evidence_history" }],
    });

    const conflicting = projectEvidenceRole({
      ...role,
      conclusion: undefined,
      conflicting: true,
    });
    expect(conflicting).toMatchObject({ conflicting: true });
    expect(conflicting).not.toHaveProperty("conclusion");
  });

  it("presents run/span lateness neutrally and never infers on-time absence", () => {
    expect(
      projectEvidenceRecord({
        ...record("evidence_late_run", "passed"),
        acceptedAfterTerminal: {
          judgedAgainst: { kind: "run", id: "run_original" },
        },
      }).acceptedAfterTerminal,
    ).toEqual({
      label: "Recorded after this run had ended.",
      tooltip:
        "When Crux Local accepted this evidence relationship, it had already received an explicit end record for this execution.",
      judgedAgainst: { kind: "run", id: "run_original" },
    });

    expect(
      projectEvidenceRecord({
        ...record("evidence_late_span", "passed"),
        acceptedAfterTerminal: {
          judgedAgainst: { kind: "span", id: "span_original" },
        },
      }).acceptedAfterTerminal?.label,
    ).toBe("Recorded after this span had ended.");
    expect(projectEvidenceRecord(record("evidence_unknown", "passed"))).not
      .toHaveProperty("acceptedAfterTerminal");
  });

  it("projects exact producer and source navigation without inventing missing targets", () => {
    const projected = projectEvidenceRecord({
      ...record("evidence_navigation", "passed"),
      producer: { kind: "execution", id: "span_producer" },
      source: { kind: "artifact", id: "artifact_source" },
    });
    expect(projected.producer).toEqual({
      kind: "execution",
      id: "span_producer",
    });
    expect(projected.source).toEqual({
      kind: "artifact",
      id: "artifact_source",
    });

    const missing = projectEvidenceRecord({
      ...record("evidence_missing_producer", "passed"),
      producer: undefined,
    });
    expect(missing.producer).toBeUndefined();
    expect(missing.unavailableNavigation).toContain(
      "Producer navigation is unavailable because its retained identity is not accessible.",
    );
  });
});

function record(
  id: string,
  conclusion: "passed" | "failed",
): EvidenceApiRecord<"verification"> {
  return {
    ref: {
      kind: "execution.evidence",
      id,
      subject: { kind: "execution", id: "span_subject" },
      role: "verification",
      evidenceKind: "custom.review",
      recordedAt: "2026-07-30T10:00:00.000Z",
    },
    source: { kind: "artifact", id: `artifact_${id}` },
    conclusion,
    supersedes: [],
    payloadState: "available",
    data: { safe: true },
  };
}
