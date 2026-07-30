import { describe, expect, it } from "vitest";
import {
  createCruxArtifactId,
  evidence,
  flow,
  observe,
} from "../../src";
import { runWithEvidenceEffectReceiptSubject } from "../../src/evidence/internal";

describe("evidence subjects", () => {
  it("prefers an explicit subject over the active execution", async () => {
    const subject = {
      kind: "artifact",
      id: createCruxArtifactId(),
    } as const;

    const result = await flow("explicit-evidence-subject", async (scope) =>
      scope.step("record", () =>
        runWithEvidenceEffectReceiptSubject(
          {
            kind: "effect.receipt",
            id: "receipt_ignored",
            effectId: "cms.publish",
          },
          () =>
            evidence.record({
              subject,
              role: "verification",
              kind: "custom.review",
              data: {},
            }),
        ),
      ),
    ).run();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.output.subject).toEqual(subject);
  });

  it("resolves the nearest effect receipt before graph projection", async () => {
    const receipt = {
      kind: "effect.receipt",
      id: "receipt_1",
      effectId: "cms.publish",
    } as const;

    const result = await flow("effect-evidence-subject", async (scope) =>
      scope.step("record", () =>
        runWithEvidenceEffectReceiptSubject(receipt, () => {
          expect(() =>
            evidence.record({
              role: "change",
              conclusion: "applied",
              kind: "custom.provider-result",
              data: {},
            }),
          ).toThrowError(
            expect.objectContaining({
              code: "EVIDENCE_REFERENCE_INVALID",
            }),
          );
          return true;
        }),
      ),
    ).run();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.output).toBe(true);
  });

  it("falls back to the active run when no span or receipt is active", () => {
    const run = observe.openRun({
      name: "run evidence subject",
      rootPrimitive: "custom.operation",
    });
    const ref = run.withContext(() =>
      evidence.record({
        role: "intent",
        kind: "custom.plan",
        data: {},
      }),
    );
    run.end();

    expect(ref.subject).toEqual({ kind: "execution", id: run.runId });
  });

  it("accepts an explicit subject outside an active execution", () => {
    const subject = {
      kind: "artifact",
      id: createCruxArtifactId(),
    } as const;

    const ref = evidence.record({
      subject,
      role: "verification",
      kind: "custom.late-review",
      data: {},
    });

    expect(ref.subject).toEqual(subject);
  });

  it("requires a subject when no execution or receipt is active", () => {
    expect(() =>
      evidence.record({
        role: "intent",
        kind: "custom.plan",
        data: {},
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "EVIDENCE_SUBJECT_REQUIRED",
      }),
    );
  });

  it("rejects a malformed explicit subject", () => {
    expect(() =>
      evidence.record({
        subject: { kind: "artifact", id: "artifact_invalid" },
        role: "verification",
        kind: "custom.review",
        data: {},
      } as never),
    ).toThrowError(
      expect.objectContaining({
        code: "EVIDENCE_REFERENCE_INVALID",
      }),
    );
  });

  it.each([
    { id: "", effectId: "cms.publish" },
    { id: "r".repeat(513), effectId: "cms.publish" },
    { id: "provider-receipt", effectId: "" },
    { id: "provider-receipt", effectId: "e".repeat(257) },
  ])("rejects an effect receipt outside the approved bounds", (receipt) => {
    expect(() =>
      evidence.record({
        subject: { kind: "effect.receipt", ...receipt },
        role: "change",
        kind: "custom.provider-result",
        data: {},
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "EVIDENCE_REFERENCE_INVALID",
      }),
    );
  });

  it("accepts the receipt bounds before requiring graph resolution", () => {
    const subject = {
      kind: "effect.receipt",
      id: "r".repeat(512),
      effectId: "e".repeat(256),
    } as const;

    expect(() =>
      evidence.record({
        subject,
        role: "change",
        kind: "custom.provider-result",
        data: {},
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "EVIDENCE_REFERENCE_INVALID",
        why: expect.stringContaining("Effects API"),
      }),
    );
  });
});
