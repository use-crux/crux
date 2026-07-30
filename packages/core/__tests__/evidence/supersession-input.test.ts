import { describe, expect, it, vi } from "vitest";
import { createCruxArtifactId, evidence, flow } from "../../src";

describe("evidence supersession input", () => {
  it("normalizes one same-subject, same-role reference", async () => {
    const result = await flow("valid-evidence-supersession", async (scope) =>
      scope.step("record", async () => {
        const first = evidence.record({
          role: "verification",
          conclusion: "failed",
          kind: "custom.check",
          data: { passed: false },
        });
        evidence.record({
          role: "verification",
          conclusion: "passed",
          kind: "custom.check",
          data: { passed: true },
          supersedes: first,
        });
        return evidence.inspect(first.subject, { includeHistory: true });
      }),
    ).run();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    const supersedes =
      result.output.roles.verification.records[0]?.supersedes;
    expect(supersedes).toEqual([
      result.output.roles.verification.history?.[0]?.ref,
    ]);
    expect(Object.isFrozen(supersedes)).toBe(true);
  });

  it.each([
    {
      name: "duplicate",
      supersedes: (ref: unknown) => [ref, ref],
    },
    {
      name: "wrong role",
      supersedes: (ref: unknown) => ({ ...ref, role: "change" }),
    },
    {
      name: "wrong subject",
      supersedes: (ref: unknown) => ({
        ...ref,
        subject: {
          kind: "effect.receipt",
          id: "different-receipt",
          effectId: "cms.publish",
        },
      }),
    },
    {
      name: "malformed ref",
      supersedes: () => ({ kind: "execution.evidence", id: "not-an-id" }),
    },
  ])("rejects a $name before collector mutation", async ({ name, supersedes }) => {
    const result = await flow(`invalid-evidence-supersession-${name}`, async (scope) =>
      scope.step("record", async () => {
        const first = evidence.record({
          role: "verification",
          conclusion: "failed",
          kind: "custom.check",
          data: {},
        });

        expect(() =>
          evidence.record({
            role: "verification",
            conclusion: "passed",
            kind: "custom.check",
            data: {},
            supersedes: supersedes(first),
          } as never),
        ).toThrowError(
          expect.objectContaining({
            code: "EVIDENCE_SUPERSESSION_INVALID",
          }),
        );

        return evidence.inspect(first.subject);
      }),
    ).run();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.output.roles.verification.records).toHaveLength(1);
  });

  it("rejects a direct cycle before accepting the record", () => {
    const subject = {
      kind: "artifact",
      id: createCruxArtifactId(),
    } as const;
    const source = {
      kind: "artifact",
      id: createCruxArtifactId(),
    } as const;
    const id = `evidence_${"ab".repeat(8)}` as const;

    vi.stubGlobal("crypto", undefined);
    const random = vi.spyOn(Math, "random").mockReturnValue(0xab / 0x100);
    try {
      expect(() =>
        evidence.record({
          subject,
          role: "verification",
          conclusion: "passed",
          ref: source,
          kind: "score.report",
          supersedes: {
            kind: "execution.evidence",
            id,
            subject,
            role: "verification",
            evidenceKind: "score.report",
            recordedAt: new Date().toISOString(),
          },
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "EVIDENCE_SUPERSESSION_INVALID",
        }),
      );
    } finally {
      random.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("rejects a cycle reachable through the local collector", async () => {
    const subject = {
      kind: "artifact",
      id: createCruxArtifactId(),
    } as const;
    const source = {
      kind: "artifact",
      id: createCruxArtifactId(),
    } as const;
    const futureId = `evidence_${"aa".repeat(8)}` as const;

    const result = await flow("indirect-evidence-cycle", async (scope) =>
      scope.step("record", async () => {
        vi.stubGlobal("crypto", undefined);
        let byteIndex = 0;
        const random = vi.spyOn(Math, "random").mockImplementation(() => {
          const byte = byteIndex < 8 ? 0xbb : 0xaa;
          byteIndex += 1;
          return byte / 0x100;
        });

        try {
          const first = evidence.record({
            subject,
            role: "verification",
            conclusion: "failed",
            ref: source,
            kind: "score.report",
            supersedes: {
              kind: "execution.evidence",
              id: futureId,
              subject,
              role: "verification",
              evidenceKind: "score.report",
              recordedAt: new Date().toISOString(),
            },
          });

          expect(() =>
            evidence.record({
              subject,
              role: "verification",
              conclusion: "passed",
              ref: source,
              kind: "score.report",
              supersedes: first,
            }),
          ).toThrowError(
            expect.objectContaining({
              code: "EVIDENCE_SUPERSESSION_INVALID",
            }),
          );
          return evidence.inspect(subject);
        } finally {
          random.mockRestore();
          vi.unstubAllGlobals();
        }
      }),
    ).run();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.output.roles.verification.records).toHaveLength(1);
  });
});
