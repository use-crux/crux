import { afterEach, describe, expect, it } from "vitest";
import {
  createCruxArtifactId,
  createInMemoryObservabilityTransport,
  evidence,
  flow,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../../src";
import { recordEvidenceCoverageFact } from "../../src/evidence/internal";
import { resetHooks, updateHooks } from "../../src/runtime/runtime";
import { runScope } from "../../src/scope/internal";

describe("evidence coverage", () => {
  afterEach(() => {
    resetHooks();
    resetObservabilityRuntime();
  });

  it("rejects coverage without an active producer span before collector mutation", async () => {
    const subject = {
      kind: "artifact",
      id: createCruxArtifactId(),
    } as const;

    const result = await runScope(
      { kind: "invocation" },
      {},
      async () => {
        let error: unknown;
        try {
          recordEvidenceCoverageFact({
            subject,
            role: "authority",
            status: "not-configured",
          });
        } catch (caught) {
          error = caught;
        }
        return error;
      },
    );

    expect(result).toMatchObject({
      code: "EVIDENCE_INPUT_INVALID",
    });
    expect(String(result)).toContain("active span");
  });

  it("emits one strict event whose timestamp is the observation time", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const subject = {
      kind: "artifact",
      id: createCruxArtifactId(),
    } as const;
    const observedAt = "2026-07-28T12:00:00.000Z";

    const result = await flow("coverage-event", async (scope) =>
      scope.step("record", async () => {
        const context = observe.captureContext();
        recordEvidenceCoverageFact({
          subject,
          role: "authority",
          status: "not-configured",
          observedAt,
        });
        return {
          spanId: context?.currentSpanId,
          view: await evidence.inspect(subject),
        };
      }),
    ).run();
    await observe.flush();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "span:event",
        spanId: result.output.spanId,
        name: "evidence.coverage",
        timestamp: observedAt,
        attributes: {
          subject,
          role: "authority",
          status: "not-configured",
        },
      }),
    );
    expect(result.output.view.roles.authority.status).toBe("not-configured");
  });

  it("rejects unsupported fields and unresolved receipt subjects before emission", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    const errors = await inCoverageSpan(() => {
      const caught: unknown[] = [];
      for (const fact of [
        {
          subject: {
            kind: "artifact",
            id: createCruxArtifactId(),
          },
          role: "authority",
          status: "not-configured",
          producer: {
            kind: "execution",
            id: "1111111111111111",
          },
        },
        {
          subject: {
            kind: "effect.receipt",
            id: "provider-receipt",
            effectId: "cms.publish",
          },
          role: "change",
          status: "not-captured",
        },
      ]) {
        try {
          recordEvidenceCoverageFact(fact as never);
        } catch (error) {
          caught.push(error);
        }
      }
      return caught;
    });
    await observe.flush();

    expect(errors).toHaveLength(2);
    expect(errors).toEqual([
      expect.objectContaining({ code: "EVIDENCE_INPUT_INVALID" }),
      expect.objectContaining({ code: "EVIDENCE_INPUT_INVALID" }),
    ]);
    expect(
      transport.records.some(
        (record) =>
          record.type === "span:event" &&
          record.name === "evidence.coverage",
      ),
    ).toBe(false);
  });

  it("appends no fact when privacy suppresses the prepared coverage event", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const subject = {
      kind: "artifact",
      id: createCruxArtifactId(),
    } as const;
    let coverageCalls = 0;
    updateHooks({
      observabilityCapture: {
        redactRecord(record) {
          if (
            record.type === "span:event" &&
            record.name === "evidence.coverage"
          ) {
            coverageCalls += 1;
            return null;
          }
          return record;
        },
      },
    });

    const error = await inCoverageSpan(async () => {
      recordEvidenceCoverageFact({
        subject,
        role: "verification",
        status: "redacted",
      });
      try {
        await evidence.inspect(subject);
      } catch (caught) {
        return caught;
      }
      return undefined;
    });
    await observe.flush();

    expect(coverageCalls).toBe(1);
    expect(error).toMatchObject({ code: "EVIDENCE_QUERY_UNAVAILABLE" });
    expect(
      transport.records.some(
        (record) =>
          record.type === "span:event" &&
          record.name === "evidence.coverage",
      ),
    ).toBe(false);
  });

  it("distinguishes an uncaptured relationship from missing role coverage", async () => {
    updateHooks({
      observabilityCapture: { capture: "off" },
    });

    const result = await flow("uncaptured-evidence-coverage", async (scope) =>
      scope.step("record", async () => {
        const ref = evidence.record({
          role: "verification",
          conclusion: "passed",
          kind: "custom.private-review",
          data: { approved: true },
        });
        return evidence.inspect(ref.subject);
      }),
    ).run();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(Object.keys(result.output.roles)).toEqual([
      "intent",
      "authority",
      "change",
      "verification",
      "recovery",
    ]);
    expect(result.output.roles.verification).toMatchObject({
      status: "not-captured",
      records: [
        expect.objectContaining({
          payloadState: "not-captured",
        }),
      ],
    });
    for (const role of ["intent", "authority", "change", "recovery"] as const) {
      expect(result.output.roles[role]).toMatchObject({
        role,
        status: "not-yet-recorded",
        records: [],
        conflicting: false,
      });
    }
  });

  it("answers from an explicit native coverage fact without inventing records", async () => {
    const subject = {
      kind: "artifact",
      id: createCruxArtifactId(),
    } as const;

    const view = await inCoverageSpan(async () => {
      recordEvidenceCoverageFact({
        subject,
        role: "authority",
        status: "not-configured",
      });
      return evidence.inspect(subject);
    });

    expect(view.source).toBe("active-scope");
    expect(view.roles.authority).toMatchObject({
      role: "authority",
      status: "not-configured",
      records: [],
      conflicting: false,
      truncated: false,
    });
    expect(view.roles.verification.status).toBe("not-yet-recorded");
  });

  it("preserves the most restrictive explicit fact without treating defaults as facts", async () => {
    const subject = {
      kind: "artifact",
      id: createCruxArtifactId(),
    } as const;

    const view = await inCoverageSpan(async () => {
      for (const status of [
        "not-applicable",
        "not-configured",
        "not-captured",
        "redacted",
      ] as const) {
        recordEvidenceCoverageFact({
          subject,
          role: "recovery",
          status,
        });
      }
      return evidence.inspect(subject);
    });

    expect(view.roles.recovery.status).toBe("redacted");
    expect(view.roles.recovery.records).toEqual([]);
    expect(view.roles.change.status).toBe("not-yet-recorded");
  });

  it("lets usable active evidence outrank a restrictive coverage fact", async () => {
    const subject = {
      kind: "artifact",
      id: createCruxArtifactId(),
    } as const;

    const view = await inCoverageSpan(async () => {
      recordEvidenceCoverageFact({
        subject,
        role: "change",
        status: "redacted",
      });
      evidence.record({
        subject,
        role: "change",
        conclusion: "applied",
        kind: "custom.state-change",
        data: { applied: true },
      });
      return evidence.inspect(subject);
    });

    expect(view.roles.change).toMatchObject({
      status: "present",
      conclusion: "applied",
      conflicting: false,
    });
  });

  it("prefers redacted over not-captured when neither relationship is usable", async () => {
    const subject = {
      kind: "artifact",
      id: createCruxArtifactId(),
    } as const;

    const view = await runScope(
      { kind: "invocation" },
      {},
      async () => {
        updateHooks({
          observabilityCapture: {
            redactRecord(record) {
              return record.type === "artifact" &&
                record.kind === "custom.redacted-check"
                ? null
                : record;
            },
          },
        });
        evidence.record({
          subject,
          role: "verification",
          kind: "custom.redacted-check",
          data: { source: 1 },
        });

        updateHooks({
          observabilityCapture: { capture: "off" },
        });
        evidence.record({
          subject,
          role: "verification",
          kind: "custom.uncaptured-check",
          data: { source: 2 },
        });
        return evidence.inspect(subject);
      },
    );

    expect(view.roles.verification).toMatchObject({
      status: "redacted",
      records: [
        expect.objectContaining({ payloadState: "redacted" }),
        expect.objectContaining({ payloadState: "not-captured" }),
      ],
    });
  });

  it("reports contradictory explicit facts without exposing the subject", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    const result = await flow("coverage-conflict", async (scope) =>
      scope.step("record", async () => {
        const context = observe.captureContext();
        const subject = {
          kind: "execution",
          id: context?.currentSpanId,
        } as const;
        recordEvidenceCoverageFact({
          subject,
          role: "recovery",
          status: "not-applicable",
        });
        recordEvidenceCoverageFact({
          subject,
          role: "recovery",
          status: "not-configured",
        });
        return evidence.inspect(subject);
      }),
    ).run();
    await observe.flush();

    expect(result.status).toBe("completed");
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "span:event",
        name: "evidence.coverage.conflict",
        attributes: { role: "recovery" },
      }),
    );
    const diagnostic = transport.records.find(
      (record) =>
        record.type === "span:event" &&
        record.name === "evidence.coverage.conflict",
    );
    expect(JSON.stringify(diagnostic)).not.toContain("execution:");
  });
});

async function inCoverageSpan<T>(fn: () => T | Promise<T>): Promise<T> {
  const result = await flow("native-coverage", async (scope) =>
    scope.step("observe", fn),
  ).run();
  if (result.status !== "completed") {
    throw new Error(`Coverage test flow ended with ${result.status}.`);
  }
  return result.output;
}
