import { afterEach, describe, expect, it } from "vitest";
import {
  createCruxArtifactId,
  createInMemoryObservabilityTransport,
  evidence,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../../src";
import { registerEvalObservabilityCaptureHooks } from "../../src/observability/eval-capture-hooks";
import { runScope } from "../../src/scope/internal";

describe("evidence admission policy", () => {
  afterEach(() => {
    resetObservabilityRuntime();
  });

  it("throws synchronously without mutation for a quarantined Eval write", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    let quarantined = true;
    const restore = registerEvalObservabilityCaptureHooks({
      currentCaptureSession: () => undefined,
      shouldQuarantineWrite: () => quarantined,
    });
    const subject = {
      kind: "artifact",
      id: createCruxArtifactId(),
    } as const;

    try {
      expect(() =>
        evidence.record({
          subject,
          role: "verification",
          conclusion: "passed",
          kind: "custom.quarantined-review",
          data: { approved: true },
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "EVIDENCE_WRITE_QUARANTINED",
        }),
      );
      expect(transport.records).toEqual([]);

      quarantined = false;
      evidence.record({
        subject,
        role: "verification",
        conclusion: "passed",
        kind: "custom.accepted-review",
        data: { approved: true },
      });
      await observe.flush();

      expect(transport.records.map((record) => record.segmentSeq)).toEqual([
        1, 2, 3, 4, 5, 6,
      ]);
    } finally {
      restore();
    }
  });

  it("authors explicit evidence normally in a diagnostics-only scope", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const subject = {
      kind: "artifact",
      id: createCruxArtifactId(),
    } as const;

    const result = await runScope(
      { kind: "invocation" },
      { policies: { evidence: "diagnostics-only" } },
      async (scope) => {
        expect(scope.policies.evidence).toBe("diagnostics-only");
        const ref = evidence.record({
          subject,
          role: "verification",
          conclusion: "passed",
          kind: "custom.diagnostics-review",
          data: { approved: true },
        });
        return {
          ref,
          view: await evidence.inspect(subject, { includeData: true }),
        };
      },
    );
    await observe.flush();

    expect(result.view.roles.verification.records[0]).toMatchObject({
      ref: result.ref,
      payloadState: "available",
      data: { approved: true },
    });
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "artifact",
        kind: "custom.diagnostics-review",
      }),
    );
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "edge",
        edgeType: "evidence.for",
      }),
    );
  });
});
