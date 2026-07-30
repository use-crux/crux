import { afterEach, describe, expect, it } from "vitest";
import fixture from "../../src/evidence/fixtures/destination-status-v1.json";
import {
  createCruxArtifactId,
  createInMemoryObservabilityTransport,
  evidence,
  resetObservabilityRuntime,
  setObservabilityTransport,
  type CruxEvidenceId,
  type EvidenceDestinationInspectResult,
  type EvidencePayloadState,
  type EvidenceRecord,
  type EvidenceRole,
  type EvidenceRoleStatus,
  type EvidenceSubject,
} from "../../src";
import { normalizeEvidenceDestinationResult } from "../../src/evidence/destination-validation";

describe("evidence destination durable role status", () => {
  afterEach(resetObservabilityRuntime);

  it("requires a closed status on every role", async () => {
    const result = destinationResult(subject());
    delete (result.roles.intent as { status?: EvidenceRoleStatus }).status;
    setResult(result);

    await expect(evidence.inspect(result.subject)).rejects.toMatchObject({
      code: "EVIDENCE_INPUT_INVALID",
    });
  });

  it("requires an exact safe active-record count on every role", async () => {
    const result = destinationResult(subject());
    delete (
      result.roles.intent as {
        activeRecordCount?: number;
      }
    ).activeRecordCount;
    setResult(result);

    await expect(evidence.inspect(result.subject)).rejects.toMatchObject({
      code: "EVIDENCE_INPUT_INVALID",
    });
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid active-record count %s",
    async (activeRecordCount) => {
      const result = destinationResult(subject());
      Object.assign(result.roles.verification, { activeRecordCount });
      setResult(result);

      await expect(evidence.inspect(result.subject)).rejects.toMatchObject({
        code: "EVIDENCE_INPUT_INVALID",
      });
    },
  );

  it("rejects a conflict with fewer than two active records", async () => {
    const result = destinationResult(subject());
    Object.assign(result.roles.verification, {
      activeRecordCount: 1,
      status: "present",
      conflicting: true,
      truncated: true,
    });
    setResult(result);

    await expect(evidence.inspect(result.subject)).rejects.toMatchObject({
      code: "EVIDENCE_INPUT_INVALID",
    });
  });

  it.each([
    {
      status: "present",
      coverage: "not-configured",
    },
    {
      status: "not-yet-recorded",
      coverage: "redacted",
    },
    {
      status: "not-configured",
      coverage: undefined,
    },
    {
      status: "not-applicable",
      coverage: "not-configured",
    },
  ] as const)("rejects inconsistent coverage for $status", async (mutation) => {
    const result = destinationResult(subject());
    Object.assign(result.roles.verification, mutation);
    setResult(result);

    await expect(evidence.inspect(result.subject)).rejects.toMatchObject({
      code: "EVIDENCE_INPUT_INVALID",
    });
  });

  it("allows conclusions on unavailable active relationships", async () => {
    const result = destinationResult(subject());
    result.roles.verification = {
      ...result.roles.verification,
      status: "redacted",
      activeRecordCount: 1,
      records: [record(result.subject, "redacted", "passed")],
      conclusion: "passed",
    };
    setResult(result);

    const view = await evidence.inspect(result.subject);

    expect(view.roles.verification).toMatchObject({
      status: "redacted",
      conclusion: "passed",
      conflicting: false,
    });
  });

  it("ignores history when validating the complete active status", async () => {
    const result = destinationResult(subject());
    result.roles.verification = {
      ...result.roles.verification,
      history: [record(result.subject, "reference", "failed")],
    };
    setResult(result);

    const view = await evidence.inspect(result.subject, {
      includeHistory: true,
    });

    expect(view.roles.verification).toMatchObject({
      status: "not-yet-recorded",
      conflicting: false,
    });
  });

  it("requires cursors to describe a selected truncated role", async () => {
    const result = destinationResult(subject());
    result.roles.verification = {
      ...result.roles.verification,
      cursor: "opaque",
    };
    setResult(result);

    await expect(
      evidence.inspect(result.subject, { role: "verification" }),
    ).rejects.toMatchObject({ code: "EVIDENCE_INPUT_INVALID" });
  });

  it("requires a cursor request page to remain marked truncated", async () => {
    const result = destinationResult(subject());
    setResult(result);

    await expect(
      evidence.inspect(result.subject, {
        role: "verification",
        cursor: "opaque",
      }),
    ).rejects.toMatchObject({ code: "EVIDENCE_INPUT_INVALID" });
  });

  it("preserves destination history when its successor is off-page", async () => {
    const result = destinationResult(subject());
    result.roles.verification = {
      ...result.roles.verification,
      status: "present",
      activeRecordCount: 1,
      history: [record(result.subject, "reference", "failed")],
      conclusion: "passed",
      truncated: true,
    };
    setResult(result);

    const view = await evidence.inspect(result.subject, {
      role: "verification",
      cursor: "opaque",
      includeHistory: true,
    });

    expect(view.roles.verification).toMatchObject({
      status: "present",
      records: [],
      history: [expect.objectContaining({ conclusion: "failed" })],
      conclusion: "passed",
      conflicting: false,
    });
  });

  it("rejects a partial aggregate contradicted by visible conclusions", async () => {
    const result = destinationResult(subject());
    result.roles.verification = {
      ...result.roles.verification,
      status: "present",
      activeRecordCount: 2,
      records: [
        record(result.subject, "reference", "passed", 1),
        record(result.subject, "reference", "failed", 2),
      ],
      truncated: true,
    };
    setResult(result);

    await expect(evidence.inspect(result.subject)).rejects.toMatchObject({
      code: "EVIDENCE_INPUT_INVALID",
    });
  });

  it("lets returned rows prove only a lower bound for partial status", async () => {
    const result = destinationResult(subject());
    result.roles.verification = {
      ...result.roles.verification,
      status: "present",
      activeRecordCount: 1,
      records: [record(result.subject, "redacted", "passed")],
      conclusion: "passed",
      truncated: true,
    };
    setResult(result);

    await expect(evidence.inspect(result.subject)).resolves.toMatchObject({
      roles: {
        verification: {
          status: "present",
        },
      },
    });
  });
});

describe("destination status V1 conformance fixture", () => {
  it.each(fixture.cases)("$name", (testCase) => {
    const requestedSubject = subject();
    const result = destinationResult(requestedSubject);
    const records = testCase.activePayloadStates.map((state, index) =>
      record(requestedSubject, state as EvidencePayloadState, "passed", index),
    );
    result.roles.verification = {
      ...result.roles.verification,
      status: testCase.status as EvidenceRoleStatus,
      activeRecordCount: testCase.activeRecordCount,
      records,
      ...(records.length > 0 ? { conclusion: "passed" as const } : {}),
      ...(testCase.coverageIncluded
        ? {
            coverage: testCase.status as
              | "redacted"
              | "not-captured"
              | "not-configured"
              | "not-applicable",
          }
        : {}),
    };
    const normalized = normalizeEvidenceDestinationResult(result, {
      subject: requestedSubject,
      limit: 50,
      includeHistory: false,
      includeData: false,
    });

    expect({
      status: normalized.roles.verification.status,
      activeRecordCount:
        normalized.roles.verification.activeRecordCount,
      coverageIncluded:
        normalized.roles.verification.coverage !== undefined,
    }).toEqual({
      status: testCase.status,
      activeRecordCount: testCase.activeRecordCount,
      coverageIncluded: testCase.coverageIncluded,
    });
  });
});

function setResult(result: EvidenceDestinationInspectResult): void {
  const transport = createInMemoryObservabilityTransport();
  setObservabilityTransport({
    ...transport,
    evidence: {
      async inspectEvidence() {
        return result;
      },
    },
  });
}

function destinationResult(
  requestedSubject: EvidenceSubject,
): EvidenceDestinationInspectResult {
  const role = <R extends EvidenceRole>(value: R) => ({
    role: value,
    status: "not-yet-recorded" as const,
    activeRecordCount: 0,
    records: [] as EvidenceRecord<R>[],
    conflicting: false,
    truncated: false,
  });
  return {
    subject: requestedSubject,
    roles: {
      intent: role("intent"),
      authority: role("authority"),
      change: role("change"),
      verification: role("verification"),
      recovery: role("recovery"),
    },
  };
}

function record(
  requestedSubject: EvidenceSubject,
  payloadState: EvidencePayloadState,
  conclusion: "passed" | "failed",
  index = 0,
): EvidenceRecord<"verification"> {
  return {
    ref: {
      kind: "execution.evidence",
      id: `evidence_${index.toString(16).padStart(16, "0")}` as CruxEvidenceId,
      subject: requestedSubject,
      role: "verification",
      evidenceKind: "score.report",
      recordedAt: "2026-07-29T12:00:00.000Z",
    },
    source: subject(),
    conclusion,
    supersedes: [],
    payloadState,
  };
}

function subject(): Extract<
  EvidenceSubject,
  { readonly kind: "artifact" }
> {
  return {
    kind: "artifact",
    id: createCruxArtifactId(),
  };
}
