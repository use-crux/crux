import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCruxArtifactId,
  createInMemoryObservabilityTransport,
  evidence,
  resetObservabilityRuntime,
  setObservabilityTransport,
  type CruxEvidenceId,
  type EvidenceDestinationInspectRequest,
  type EvidenceDestinationInspectResult,
  type EvidenceRecord,
  type EvidenceSubject,
} from "../../src";

describe("evidence readable destination", () => {
  afterEach(() => {
    resetObservabilityRuntime();
  });

  it("inspects a destination-only subject through a frozen bounded request", async () => {
    const subject = artifactSubject();
    const requestSpy = vi.fn(
      async (
        request: EvidenceDestinationInspectRequest,
      ): Promise<EvidenceDestinationInspectResult> => {
        expect(Object.isFrozen(request)).toBe(true);
        return destinationResult(subject, [
          verificationRecord(subject, "passed"),
        ]);
      },
    );
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport({
      ...transport,
      evidence: { inspectEvidence: requestSpy },
    });

    const view = await evidence.inspect(subject);

    expect(requestSpy).toHaveBeenCalledWith({
      subject,
      limit: 50,
      includeHistory: false,
      includeData: false,
    });
    expect(view).toMatchObject({
      subject,
      source: "destination",
      roles: {
        verification: {
          status: "present",
          conclusion: "passed",
          conflicting: false,
          truncated: false,
          records: [
            expect.objectContaining({
              conclusion: "passed",
              payloadState: "reference",
            }),
          ],
        },
      },
    });
  });

  it("captures the selected destination synchronously before awaiting it", async () => {
    const subject = artifactSubject();
    let resolveFirst:
      | ((result: EvidenceDestinationInspectResult) => void)
      | undefined;
    const first = vi.fn(
      () =>
        new Promise<EvidenceDestinationInspectResult>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const second = vi.fn(async () =>
      destinationResult(subject, [verificationRecord(subject, "failed")]),
    );
    const base = createInMemoryObservabilityTransport();
    setObservabilityTransport({
      ...base,
      evidence: { inspectEvidence: first },
    });

    const pending = evidence.inspect(subject);
    setObservabilityTransport({
      ...base,
      evidence: { inspectEvidence: second },
    });
    resolveFirst?.(
      destinationResult(subject, [verificationRecord(subject, "passed")]),
    );
    const view = await pending;

    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    expect(view.roles.verification.conclusion).toBe("passed");
  });

  it("passes opaque paging through the selected role and preserves other summaries", async () => {
    const subject = artifactSubject();
    const requestSpy = vi.fn(
      async (
        request: EvidenceDestinationInspectRequest,
      ): Promise<EvidenceDestinationInspectResult> => {
        const result = destinationResult(subject, []);
        return {
          ...result,
          roles: {
            ...result.roles,
            change: {
              role: "change",
              status: "present",
              activeRecordCount: 1,
              records: [],
              conclusion: "applied",
              conflicting: false,
              truncated: false,
            },
            verification: {
              role: "verification",
              status: "not-yet-recorded",
              activeRecordCount: 0,
              records: [],
              conflicting: false,
              truncated: true,
              cursor: "destination-next",
            },
          },
        };
      },
    );
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport({
      ...transport,
      evidence: { inspectEvidence: requestSpy },
    });

    const view = await evidence.inspect(subject, {
      role: "verification",
      limit: 7,
      cursor: "destination-current",
      includeHistory: true,
    });

    expect(requestSpy).toHaveBeenCalledWith({
      subject,
      role: "verification",
      limit: 7,
      cursor: "destination-current",
      includeHistory: true,
      includeData: false,
    });
    expect(view.roles.verification).toMatchObject({
      records: [],
      truncated: true,
      cursor: "destination-next",
    });
    expect(view.roles.change).toMatchObject({
      records: [],
      status: "present",
      conclusion: "applied",
      conflicting: false,
    });
  });

  it("accepts and forwards the inclusive opaque cursor bound", async () => {
    const subject = artifactSubject();
    const cursor = "c".repeat(4_096);
    const requestSpy = vi.fn(
      async (
        request: EvidenceDestinationInspectRequest,
      ): Promise<EvidenceDestinationInspectResult> => {
        const result = destinationResult(request.subject, []);
        return {
          ...result,
          roles: {
            ...result.roles,
            verification: {
              ...result.roles.verification,
              truncated: true,
            },
          },
        };
      },
    );
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport({
      ...transport,
      evidence: { inspectEvidence: requestSpy },
    });

    await evidence.inspect(subject, {
      role: "verification",
      cursor,
    });

    expect(requestSpy).toHaveBeenCalledWith(
      expect.objectContaining({ cursor }),
    );
  });
});

function artifactSubject(): EvidenceSubject {
  return Object.freeze({
    kind: "artifact",
    id: createCruxArtifactId(),
  });
}

function verificationRecord(
  subject: EvidenceSubject,
  conclusion: "passed" | "failed",
): EvidenceRecord<"verification"> {
  const recordedAt = "2026-07-28T12:00:00.000Z";
  return Object.freeze({
    ref: Object.freeze({
      kind: "execution.evidence",
      id: `evidence_${"ab".repeat(8)}` as CruxEvidenceId,
      subject,
      role: "verification",
      evidenceKind: "score.report",
      recordedAt,
    }),
    source: Object.freeze({
      kind: "artifact",
      id: createCruxArtifactId(),
    }),
    conclusion,
    supersedes: Object.freeze([]),
    payloadState: "reference",
  });
}

function destinationResult(
  subject: EvidenceSubject,
  verification: readonly EvidenceRecord<"verification">[],
): EvidenceDestinationInspectResult {
  return {
    subject,
    roles: {
      intent: emptyRole("intent"),
      authority: emptyRole("authority"),
      change: emptyRole("change"),
      verification: {
        role: "verification",
        status: verification.length > 0 ? "present" : "not-yet-recorded",
        activeRecordCount: verification.length,
        records: verification,
        conclusion: verification[0]?.conclusion,
        conflicting: false,
        truncated: false,
      },
      recovery: emptyRole("recovery"),
    },
  };
}

function emptyRole<
  R extends "intent" | "authority" | "change" | "recovery",
>(role: R) {
  return {
    role,
    status: "not-yet-recorded",
    activeRecordCount: 0,
    records: [],
    conflicting: false,
    truncated: false,
  } as const;
}
