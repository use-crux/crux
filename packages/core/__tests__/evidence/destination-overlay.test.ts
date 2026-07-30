import { afterEach, describe, expect, it } from "vitest";
import {
  createCruxArtifactId,
  createInMemoryObservabilityTransport,
  evidence,
  flow,
  resetObservabilityRuntime,
  setObservabilityTransport,
  type CruxEvidenceId,
  type EvidenceDestinationInspectResult,
  type EvidenceRecord,
  type EvidenceRef,
  type EvidenceSubject,
} from "../../src";
import { recordEvidenceCoverageFact } from "../../src/evidence/internal";
import { runScope } from "../../src/scope/internal";

describe("evidence destination overlay", () => {
  afterEach(() => {
    resetObservabilityRuntime();
  });

  it("deduplicates an equivalent local read-your-writes relationship", async () => {
    const subject = artifactSubject();
    const source = artifactSubject();
    let durable: EvidenceRecord<"verification"> | undefined;
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport({
      ...transport,
      evidence: {
        async inspectEvidence() {
          if (!durable) throw new Error("test record was not initialized");
          return resultFor(subject, [durable]);
        },
      },
    });

    const view = await runScope(
      { kind: "invocation" },
      {},
      async () => {
        const ref = evidence.record({
          subject,
          role: "verification",
          conclusion: "passed",
          ref: source,
          kind: "score.report",
        });
        durable = recordFromRef(ref, source, "passed");
        return evidence.inspect(subject);
      },
    );

    expect(view.source).toBe("active-scope");
    expect(view.roles.verification.records).toHaveLength(1);
    expect(view.roles.verification).toMatchObject({
      conclusion: "passed",
      conflicting: false,
    });
  });

  it("widens conflict when a local claim disagrees with durable evidence", async () => {
    const subject = artifactSubject();
    const durable = standaloneRecord(subject, "failed", "aa");
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport({
      ...transport,
      evidence: {
        async inspectEvidence() {
          return resultFor(subject, [durable]);
        },
      },
    });

    const view = await runScope(
      { kind: "invocation" },
      {},
      async () => {
        evidence.record({
          subject,
          role: "verification",
          conclusion: "passed",
          ref: artifactSubject(),
          kind: "score.report",
        });
        return evidence.inspect(subject);
      },
    );

    expect(view.roles.verification.records).toHaveLength(2);
    expect(view.roles.verification.conflicting).toBe(true);
    expect(view.roles.verification).not.toHaveProperty("conclusion");
  });

  it("merges explicit facts using restrictive precedence", async () => {
    const subject = artifactSubject();
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport({
      ...transport,
      evidence: {
        async inspectEvidence() {
          return resultFor(subject, [], {
            coverage: "not-configured",
          });
        },
      },
    });

    const result = await flow("coverage-overlay", async (scope) =>
      scope.step("observe", async () => {
        recordEvidenceCoverageFact({
          subject,
          role: "verification",
          status: "redacted",
        });
        return evidence.inspect(subject);
      }),
    ).run();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.output.source).toBe("active-scope");
    expect(result.output.roles.verification.status).toBe("redacted");
  });

  it("lets active-scope evidence lift a durable redacted summary", async () => {
    const subject = artifactSubject();
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport({
      ...transport,
      evidence: {
        async inspectEvidence() {
          return resultFor(subject, [], { coverage: "redacted" });
        },
      },
    });

    const result = await runScope(
      { kind: "invocation" },
      {},
      async () => {
        evidence.record({
          subject,
          role: "verification",
          conclusion: "passed",
          ref: artifactSubject(),
          kind: "score.report",
        });
        return evidence.inspect(subject);
      },
    );

    expect(result.roles.verification.status).toBe("present");
  });

  it("does not let local non-present coverage weaken durable evidence", async () => {
    const subject = artifactSubject();
    const durable = standaloneRecord(subject, "passed", "cc");
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport({
      ...transport,
      evidence: {
        async inspectEvidence() {
          return resultFor(subject, [durable]);
        },
      },
    });

    const result = await flow("durable-present-overlay", async (scope) =>
      scope.step("observe", async () => {
        recordEvidenceCoverageFact({
          subject,
          role: "verification",
          status: "redacted",
        });
        return evidence.inspect(subject);
      }),
    ).run();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.output.roles.verification.status).toBe("present");
  });
});

function artifactSubject(): Extract<
  EvidenceSubject,
  { readonly kind: "artifact" }
> {
  return Object.freeze({
    kind: "artifact",
    id: createCruxArtifactId(),
  });
}

function standaloneRecord(
  subject: EvidenceSubject,
  conclusion: "passed" | "failed",
  byte: string,
): EvidenceRecord<"verification"> {
  const ref = {
    kind: "execution.evidence",
    id: `evidence_${byte.repeat(16)}` as CruxEvidenceId,
    subject,
    role: "verification",
    evidenceKind: "score.report",
    recordedAt: "2026-07-28T12:00:00.000Z",
  } as const satisfies EvidenceRef<"verification">;
  return recordFromRef(ref, artifactSubject(), conclusion);
}

function recordFromRef(
  ref: EvidenceRef<"verification">,
  source: EvidenceRecord["source"],
  conclusion: "passed" | "failed",
): EvidenceRecord<"verification"> {
  return Object.freeze({
    ref,
    source,
    conclusion,
    supersedes: Object.freeze([]),
    payloadState: "reference",
  });
}

function resultFor(
  subject: EvidenceSubject,
  records: readonly EvidenceRecord<"verification">[],
  options: {
    readonly coverage?: "not-configured" | "redacted";
  } = {},
): EvidenceDestinationInspectResult {
  const empty = (role: "intent" | "authority" | "change" | "recovery") => ({
    role,
    status: "not-yet-recorded",
    activeRecordCount: 0,
    records: [],
    conflicting: false,
    truncated: false,
  }) as const;
  const conclusions = new Set(records.map(({ conclusion }) => conclusion));
  return {
    subject,
    roles: {
      intent: empty("intent"),
      authority: empty("authority"),
      change: empty("change"),
      verification: {
        role: "verification",
        status:
          records.length > 0
            ? "present"
            : options.coverage ?? "not-yet-recorded",
        activeRecordCount: records.length,
        records,
        ...(options.coverage ? { coverage: options.coverage } : {}),
        ...(conclusions.size === 1
          ? { conclusion: [...conclusions][0] }
          : {}),
        conflicting: conclusions.size > 1,
        truncated: false,
      },
      recovery: empty("recovery"),
    },
  };
}
