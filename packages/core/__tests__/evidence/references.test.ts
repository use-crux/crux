import { describe, expect, it } from "vitest";
import {
  createCruxArtifactId,
  createCruxRunId,
  evidence,
  flow,
} from "../../src";

describe("evidence source references", () => {
  it("links an existing artifact without copying payload", async () => {
    const source = {
      kind: "artifact",
      id: createCruxArtifactId(),
    } as const;

    const result = await flow("referenced-evidence", async (scope) =>
      scope.step("record", async () => {
        const ref = evidence.record({
          role: "verification",
          conclusion: "passed",
          ref: source,
          kind: "score.report",
        });
        return evidence.inspect(ref.subject, { includeData: true });
      }),
    ).run();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.output.roles.verification.records[0]).toMatchObject({
      source,
      payloadState: "reference",
    });
    expect(result.output.roles.verification.records[0]).not.toHaveProperty(
      "data",
    );
  });

  it("rejects an invalid explicit kind for a reference", () => {
    expect(() =>
      evidence.record({
        subject: { kind: "artifact", id: createCruxArtifactId() },
        role: "verification",
        ref: { kind: "artifact", id: createCruxArtifactId() },
        kind: "custom.crux.internal",
      } as never),
    ).toThrowError(
      expect.objectContaining({
        code: "EVIDENCE_KIND_INVALID",
      }),
    );
  });

  it("requires an explicit kind when local metadata cannot resolve one", () => {
    expect(() =>
      evidence.record({
        subject: { kind: "artifact", id: createCruxArtifactId() },
        role: "verification",
        ref: { kind: "artifact", id: createCruxArtifactId() },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "EVIDENCE_KIND_INVALID",
      }),
    );
  });

  it("resolves an omitted kind from Core-owned local artifact metadata", async () => {
    const result = await flow("local-evidence-kind", async (scope) =>
      scope.step("record", async () => {
        const first = evidence.record({
          role: "verification",
          conclusion: "passed",
          kind: "custom.local-check",
          data: { passed: true },
        });
        const view = await evidence.inspect(first.subject, {
          includeData: true,
        });
        const source = view.roles.verification.records[0]?.source;
        if (!source) throw new Error("Expected the inline source.");

        const second = evidence.record({
          role: "verification",
          conclusion: "passed",
          ref: source,
        });

        return second.evidenceKind;
      }),
    ).run();

    expect(result).toMatchObject({
      status: "completed",
      output: "custom.local-check",
    });
  });

  it("links execution refs and rejects unresolved receipt refs", async () => {
    const execution = {
      kind: "execution",
      id: createCruxRunId(),
    } as const;
    const receipt = {
      kind: "effect.receipt",
      id: "provider-receipt-1",
      effectId: "cms.publish",
    } as const;

    const result = await flow("canonical-evidence-references", async (scope) =>
      scope.step("record", async () => {
        const verification = evidence.record({
          role: "verification",
          conclusion: "passed",
          ref: execution,
          kind: "custom.execution-trace",
        });
        expect(() =>
          evidence.record({
            role: "change",
            conclusion: "applied",
            ref: receipt,
            kind: "custom.effect-receipt",
          }),
        ).toThrowError(
          expect.objectContaining({
            code: "EVIDENCE_REFERENCE_INVALID",
          }),
        );
        return evidence.inspect(verification.subject);
      }),
    ).run();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.output.roles.verification.records[0]?.source).toEqual(
      execution,
    );
    expect(result.output.roles.change.records).toEqual([]);
  });
});
