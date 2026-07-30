import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EvidencePanel } from "./EvidencePanel";
import type { EvidenceApiInspectResult } from "./types";

let inspectionLoading = false;
const useEvidenceNavigation = vi.fn(() => ({
  resultFor: () => ({
    status: "resolved" as const,
    target: {
      kind: "span" as const,
      spanId: "span_target",
      runId: "run_target",
      traceId: "trace_target",
      retainedDefinitionRefs: [],
    },
  }),
  loading: false,
  error: null,
}));

const inspectResult: EvidenceApiInspectResult = {
  subject: { kind: "execution", id: "span_subject" },
  roles: {
    intent: {
      role: "intent",
      status: "not-yet-recorded",
      activeRecordCount: 0,
      records: [],
      conflicting: false,
      truncated: false,
    },
    authority: {
      role: "authority",
      status: "not-configured",
      activeRecordCount: 0,
      records: [],
      coverage: "not-configured",
      conflicting: false,
      truncated: false,
    },
    change: {
      role: "change",
      status: "not-applicable",
      activeRecordCount: 0,
      records: [],
      coverage: "not-applicable",
      conflicting: false,
      truncated: false,
    },
    verification: {
      role: "verification",
      status: "present",
      activeRecordCount: 1,
      records: [
        {
          ref: {
            kind: "execution.evidence",
            id: "evidence_active",
            subject: { kind: "execution", id: "span_subject" },
            role: "verification",
            evidenceKind: "custom.review",
            recordedAt: "2026-07-30T10:00:00.000Z",
          },
          source: { kind: "artifact", id: "artifact_review" },
          producer: { kind: "execution", id: "span_reviewer" },
          conclusion: "passed",
          supersedes: [],
          payloadState: "redacted",
          payloadUnavailableReason: "retention",
          acceptedAfterTerminal: {
            judgedAgainst: { kind: "span", id: "span_subject" },
          },
        },
      ],
      history: [
        {
          ref: {
            kind: "execution.evidence",
            id: "evidence_history",
            subject: { kind: "execution", id: "span_subject" },
            role: "verification",
            evidenceKind: "score.report",
            recordedAt: "2026-07-30T09:00:00.000Z",
          },
          source: { kind: "artifact", id: "artifact_score" },
          conclusion: "failed",
          supersedes: [],
          payloadState: "reference",
        },
      ],
      conflicting: true,
      truncated: true,
      cursor: "opaque-cursor",
    },
    recovery: {
      role: "recovery",
      status: "redacted",
      activeRecordCount: 0,
      records: [],
      coverage: "redacted",
      conflicting: false,
      truncated: false,
    },
  },
};

vi.mock("./useEvidenceInspection", () => ({
  useEvidenceInspection: () => ({
    result: inspectionLoading ? undefined : inspectResult,
    loading: inspectionLoading,
    fetchingMore: false,
    error: null,
    loadOlder: () => undefined,
    hasOlder: true,
  }),
}));

vi.mock("./useEvidenceNavigation", () => ({
  useEvidenceNavigation: (...args: Parameters<typeof useEvidenceNavigation>) =>
    useEvidenceNavigation(...args),
}));

describe("EvidencePanel", () => {
  it("keeps navigation hook order stable while inspection is loading", () => {
    inspectionLoading = true;
    useEvidenceNavigation.mockClear();

    const html = renderToStaticMarkup(
      <EvidencePanel
        subject={{ kind: "execution", id: "span_subject" }}
        selectedRole="verification"
        onSelectRole={() => undefined}
        onNavigateTarget={() => undefined}
      />,
    );

    expect(html).toContain("Loading evidence");
    expect(useEvidenceNavigation).toHaveBeenCalledWith([]);
    inspectionLoading = false;
  });

  it("renders all roles, complete aggregates, history, lateness, and payload state", () => {
    const html = renderToStaticMarkup(
      <EvidencePanel
        subject={{ kind: "execution", id: "span_subject" }}
        selectedRole="verification"
        onSelectRole={() => undefined}
        onNavigateTarget={() => undefined}
      />,
    );

    for (const role of [
      "Intent",
      "Authority",
      "Change",
      "Verification",
      "Recovery",
    ]) {
      expect(html).toContain(role);
    }
    expect(html).toContain('data-evidence-role-list="scroll"');
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("sm:grid");
    expect(html).toContain("No evidence recorded yet");
    expect(html).toContain("Native producer not configured");
    expect(html).toContain("This role does not apply");
    expect(html).toContain("Conflicting conclusions");
    expect(html).not.toContain("Conclusion · passed");
    expect(html).toContain("Payload expired");
    expect(html).toContain("Recorded after this span had ended.");
    expect(html).toContain("History · 1");
    expect(html).toContain("Result may be incomplete");
    expect(html).toContain("Load older");
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain("shown");
  });

  it("renders native semantic labels and exact navigation controls", () => {
    const html = renderToStaticMarkup(
      <EvidencePanel
        subject={{ kind: "execution", id: "span_subject" }}
        selectedRole="verification"
        onSelectRole={() => undefined}
        onNavigateTarget={() => undefined}
      />,
    );
    expect(html).toContain("Evaluation");
    expect(html).toContain("Evidence record");
    expect(html).toContain("Open producer execution");
    expect(html).toContain("Open source artifact");
    expect(html).toContain('type="button"');
  });
});
