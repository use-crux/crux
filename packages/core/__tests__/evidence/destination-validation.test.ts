import { afterEach, describe, expect, it } from "vitest";
import {
  CruxEvidenceError,
  createCruxArtifactId,
  createInMemoryObservabilityTransport,
  evidence,
  resetObservabilityRuntime,
  setObservabilityTransport,
  type CruxEvidenceId,
  type EvidenceDestinationInspectResult,
  type EvidenceRecord,
  type EvidenceSubject,
} from "../../src";

describe("evidence destination validation", () => {
  afterEach(() => {
    resetObservabilityRuntime();
  });

  it("rejects a complete aggregate that contradicts its hydrated rows", async () => {
    const subject = artifactSubject();
    const result = validResult(subject);
    result.roles.verification.records = [record(subject, "passed")];
    result.roles.verification.activeRecordCount = 1;
    result.roles.verification.conclusion = "failed";
    result.roles.verification.status = "present";
    setResult(result);

    await expect(evidence.inspect(subject)).rejects.toMatchObject({
      code: "EVIDENCE_INPUT_INVALID",
    });
  });

  it("rejects divergent duplicate evidence IDs from one destination", async () => {
    const subject = artifactSubject();
    const first = record(subject, "passed");
    const second = {
      ...first,
      source: artifactSubject(),
    };
    const result = validResult(subject);
    result.roles.verification.records = [first, second];
    result.roles.verification.activeRecordCount = 1;
    result.roles.verification.conclusion = "passed";
    result.roles.verification.status = "present";
    setResult(result);

    await expect(evidence.inspect(subject)).rejects.toMatchObject({
      code: "EVIDENCE_IDEMPOTENCY_CONFLICT",
    });
  });

  it("deduplicates equivalent repeated rows from one destination", async () => {
    const subject = artifactSubject();
    const first = record(subject, "passed");
    const result = validResult(subject);
    result.roles.verification.records = [first, { ...first }];
    result.roles.verification.activeRecordCount = 1;
    result.roles.verification.conclusion = "passed";
    result.roles.verification.status = "present";
    setResult(result);

    const view = await evidence.inspect(subject);

    expect(view.roles.verification.records).toHaveLength(1);
  });

  it("rejects data attached to a redacted destination relationship", async () => {
    const subject = artifactSubject();
    const unsafe = {
      ...record(subject, "passed"),
      payloadState: "redacted",
      data: { secret: "RAW-DESTINATION-PAYLOAD" },
    } as const;
    const result = validResult(subject);
    result.roles.verification.records = [unsafe as EvidenceRecord<"verification">];
    result.roles.verification.activeRecordCount = 1;
    result.roles.verification.conclusion = "passed";
    result.roles.verification.status = "redacted";
    setResult(result);

    await expect(evidence.inspect(subject, { includeData: true })).rejects.toMatchObject({
      code: "EVIDENCE_INPUT_INVALID",
    });
  });

  it("detaches retention and accepted-after-terminal destination metadata", async () => {
    const subject = {
      kind: "execution",
      id: "run_111111111111111111111111",
    } as const;
    const acceptedAfterTerminal = {
      judgedAgainst: {
        kind: "run",
        id: subject.id,
      },
    };
    const durable = {
      ...record(subject, "passed"),
      payloadState: "redacted",
      payloadUnavailableReason: "retention",
      acceptedAfterTerminal,
    } as const;
    const result = validResult(subject);
    result.roles.verification.records = [
      durable as unknown as EvidenceRecord<"verification">,
    ];
    result.roles.verification.activeRecordCount = 1;
    result.roles.verification.conclusion = "passed";
    result.roles.verification.status = "redacted";
    setResult(result);

    const view = await evidence.inspect(subject);
    acceptedAfterTerminal.judgedAgainst.id =
      "run_222222222222222222222222";
    const normalized = view.roles.verification.records[0];

    expect(normalized).toMatchObject({
      payloadState: "redacted",
      payloadUnavailableReason: "retention",
      acceptedAfterTerminal: {
        judgedAgainst: {
          kind: "run",
          id: subject.id,
        },
      },
    });
    expect(Object.isFrozen(normalized?.acceptedAfterTerminal)).toBe(true);
    expect(
      Object.isFrozen(normalized?.acceptedAfterTerminal?.judgedAgainst),
    ).toBe(true);
  });

  it.each([
    {
      name: "unavailable reason on a reference",
      mutate(record: EvidenceRecord<"verification">) {
        return {
          ...record,
          payloadUnavailableReason: "retention",
        };
      },
    },
    {
      name: "false accepted-after-terminal marker",
      mutate(record: EvidenceRecord<"verification">) {
        return {
          ...record,
          acceptedAfterTerminal: {
            afterTerminal: false,
          },
        };
      },
    },
    {
      name: "accepted-after-terminal on an artifact subject",
      mutate(record: EvidenceRecord<"verification">) {
        return {
          ...record,
          acceptedAfterTerminal: {
            judgedAgainst: {
              kind: "run",
              id: "run_111111111111111111111111",
            },
          },
        };
      },
    },
  ])("rejects $name", async ({ mutate }) => {
    const subject = artifactSubject();
    const result = validResult(subject);
    result.roles.verification.records = [
      mutate(record(subject, "passed")) as EvidenceRecord<"verification">,
    ];
    result.roles.verification.activeRecordCount = 1;
    result.roles.verification.conclusion = "passed";
    result.roles.verification.status =
      result.roles.verification.records[0]?.payloadState === "redacted"
        ? "redacted"
        : "present";
    setResult(result);

    await expect(evidence.inspect(subject)).rejects.toMatchObject({
      code: "EVIDENCE_INPUT_INVALID",
    });
  });

  it("rejects a cursor returned on a non-selected role", async () => {
    const subject = artifactSubject();
    const result = validResult(subject);
    result.roles.change.cursor = "wrong-role-cursor";
    setResult(result);

    await expect(
      evidence.inspect(subject, { role: "verification" }),
    ).rejects.toMatchObject({
      code: "EVIDENCE_CURSOR_INVALID",
    });
  });

  it("preserves a truncated destination conflict instead of inferring a winner", async () => {
    const subject = artifactSubject();
    const result = validResult(subject);
    result.roles.verification.records = [record(subject, "passed")];
    result.roles.verification.activeRecordCount = 2;
    result.roles.verification.conflicting = true;
    result.roles.verification.truncated = true;
    result.roles.verification.status = "present";
    setResult(result);

    const view = await evidence.inspect(subject);

    expect(view.roles.verification.conflicting).toBe(true);
    expect(view.roles.verification).not.toHaveProperty("conclusion");
  });

  it("uses the durable status for an unselected conclusion-less role", async () => {
    const subject = artifactSubject();
    const result = validResult(subject);
    Object.assign(result.roles.intent, {
      status: "present",
      truncated: true,
    });
    setResult(result);

    const view = await evidence.inspect(subject, {
      role: "verification",
    });

    expect(view.roles.intent.status).toBe("present");
  });

  it.each([
    "EVIDENCE_SUBJECT_NOT_FOUND",
    "EVIDENCE_ACCESS_DENIED",
  ] as const)("preserves a structured %s destination rejection", async (code) => {
    const subject = artifactSubject();
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport({
      ...transport,
      evidence: {
        async inspectEvidence() {
          throw new CruxEvidenceError({
            code,
            whatFailed: "Destination query failed.",
            why: "The destination rejected this safe test query.",
            whatStillWorks: "No source was mutated.",
            nextStep: "Use an authorized existing subject.",
          });
        },
      },
    });

    await expect(evidence.inspect(subject)).rejects.toMatchObject({ code });
  });

  it("maps an arbitrary destination failure to a safe unavailable error", async () => {
    const subject = artifactSubject();
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport({
      ...transport,
      evidence: {
        async inspectEvidence() {
          throw new Error("RAW-DESTINATION-SECRET");
        },
      },
    });

    const rejection = await evidence.inspect(subject).catch((error) => error);
    expect(rejection).toMatchObject({
      code: "EVIDENCE_QUERY_UNAVAILABLE",
    });
    expect(String(rejection)).not.toContain("RAW-DESTINATION-SECRET");
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

function artifactSubject(): Extract<
  EvidenceSubject,
  { readonly kind: "artifact" }
> {
  return {
    kind: "artifact",
    id: createCruxArtifactId(),
  };
}

function record(
  subject: EvidenceSubject,
  conclusion: "passed" | "failed",
): EvidenceRecord<"verification"> {
  return {
    ref: {
      kind: "execution.evidence",
      id: `evidence_${"ab".repeat(8)}` as CruxEvidenceId,
      subject,
      role: "verification",
      evidenceKind: "score.report",
      recordedAt: "2026-07-28T12:00:00.000Z",
    },
    source: artifactSubject(),
    conclusion,
    supersedes: [],
    payloadState: "reference",
  };
}

function validResult(subject: EvidenceSubject) {
  const empty = (role: "intent" | "authority" | "change" | "recovery") => ({
    role,
    status: "not-yet-recorded" as const,
    activeRecordCount: 0,
    records: [] as EvidenceRecord[],
    conflicting: false,
    truncated: false,
  });
  return {
    subject,
    roles: {
      intent: empty("intent"),
      authority: empty("authority"),
      change: empty("change"),
      verification: {
        role: "verification" as const,
        status: "not-yet-recorded" as const,
        activeRecordCount: 0,
        records: [] as EvidenceRecord<"verification">[],
        conclusion: undefined as "passed" | "failed" | undefined,
        conflicting: false,
        truncated: false,
      },
      recovery: empty("recovery"),
    },
  } satisfies EvidenceDestinationInspectResult;
}
