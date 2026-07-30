import { describe, expect, it } from "vitest";
import {
  CruxEvidenceError,
  createCruxRunId,
  evidence,
  flow,
  observe,
} from "../../src";

describe("evidence runtime validation", () => {
  it("rejects combined inline data and references before collection", async () => {
    await flow("invalid-evidence-source", async (scope) =>
      scope.step("reject", async () => {
        const subject = {
          kind: "execution",
          id: observe.captureContext()!.currentSpanId!,
        } as const;

        expect(() =>
          evidence.record({
            role: "verification",
            kind: "custom.review",
            data: { ok: true },
            ref: subject,
          } as never),
        ).toThrowError(
          expect.objectContaining({
            code: "EVIDENCE_INPUT_INVALID",
          }),
        );
        await expect(evidence.inspect(subject)).rejects.toSatisfy(
          (error: unknown) =>
            CruxEvidenceError.isInstance(error) &&
            error.code === "EVIDENCE_QUERY_UNAVAILABLE",
        );
      }),
    ).run();
  });

  it.each([
    { data: undefined, kind: "custom.review" },
    { ref: undefined, kind: "score.report" },
  ])("rejects an undefined own source property", (source) => {
    expect(() =>
      evidence.record({
        subject: { kind: "execution", id: createCruxRunId() },
        role: "verification",
        ...source,
      } as never),
    ).toThrowError(
      expect.objectContaining({
        code: "EVIDENCE_INPUT_INVALID",
      }),
    );
  });

  it("rejects an unsupported role", () => {
    expect(() =>
      evidence.record({
        subject: { kind: "execution", id: createCruxRunId() },
        role: "audit",
        kind: "custom.review",
        data: {},
      } as never),
    ).toThrowError(
      expect.objectContaining({
        code: "EVIDENCE_INPUT_INVALID",
      }),
    );
  });

  it("rejects a conclusion for intent evidence", () => {
    expect(() =>
      evidence.record({
        subject: { kind: "execution", id: createCruxRunId() },
        role: "intent",
        conclusion: "inconclusive",
        kind: "custom.plan",
        data: {},
      } as never),
    ).toThrowError(
      expect.objectContaining({
        code: "EVIDENCE_CONCLUSION_INVALID",
      }),
    );
  });

  it("rejects a canonical kind for inline application evidence", () => {
    expect(() =>
      evidence.record({
        subject: { kind: "execution", id: createCruxRunId() },
        role: "verification",
        kind: "score.report",
        data: {},
      } as never),
    ).toThrowError(
      expect.objectContaining({
        code: "EVIDENCE_KIND_INVALID",
      }),
    );
  });

  it.each([
    "custom.",
    " custom.review",
    "custom.review ",
    "custom.re\u0000view",
    "custom.crux.internal",
    `custom.${"x".repeat(122)}`,
  ])("rejects an invalid custom kind", (kind) => {
    expect(() =>
      evidence.record({
        subject: { kind: "execution", id: createCruxRunId() },
        role: "verification",
        kind,
        data: {},
      } as never),
    ).toThrowError(
      expect.objectContaining({
        code: "EVIDENCE_KIND_INVALID",
      }),
    );
  });

  it("rejects non-JSON inline data", () => {
    expect(() =>
      evidence.record({
        subject: { kind: "execution", id: createCruxRunId() },
        role: "verification",
        kind: "custom.review",
        data: { score: Number.NaN },
      } as never),
    ).toThrowError(
      expect.objectContaining({
        code: "EVIDENCE_INPUT_INVALID",
      }),
    );
  });

  it("rejects an invalid observedAt timestamp", () => {
    expect(() =>
      evidence.record({
        subject: { kind: "execution", id: createCruxRunId() },
        role: "verification",
        kind: "custom.review",
        data: {},
        observedAt: "eventually",
      } as never),
    ).toThrowError(
      expect.objectContaining({
        code: "EVIDENCE_INPUT_INVALID",
      }),
    );
  });

  it.each(["", "x".repeat(257)])(
    "rejects an invalid idempotency key bound",
    (idempotencyKey) => {
      expect(() =>
        evidence.record({
          subject: { kind: "execution", id: createCruxRunId() },
          role: "verification",
          kind: "custom.review",
          data: {},
          idempotencyKey,
        } as never),
      ).toThrowError(
        expect.objectContaining({
          code: "EVIDENCE_INPUT_INVALID",
        }),
      );
    },
  );

  it.each([0, -1, 1.5, 51])(
    "rejects an invalid inspect limit instead of clamping",
    async (limit) => {
      await expect(
        evidence.inspect(
          { kind: "execution", id: createCruxRunId() },
          { limit },
        ),
      ).rejects.toMatchObject({
        code: "EVIDENCE_INPUT_INVALID",
      });
    },
  );

  it.each([
    { role: "audit" },
    { includeData: "yes" },
    { includeHistory: 1 },
  ])("rejects an invalid inspect option shape", async (options) => {
    await expect(
      evidence.inspect(
        { kind: "execution", id: createCruxRunId() },
        options as never,
      ),
    ).rejects.toMatchObject({
      code: "EVIDENCE_INPUT_INVALID",
    });
  });

  it("rejects a cursor without a selected role", async () => {
    await expect(
      evidence.inspect(
        { kind: "execution", id: createCruxRunId() },
        { cursor: "opaque" },
      ),
    ).rejects.toMatchObject({
      code: "EVIDENCE_CURSOR_INVALID",
    });
  });

  it.each(["", "x".repeat(4_097)])(
    "rejects an invalid cursor bound",
    async (cursor) => {
      await expect(
        evidence.inspect(
          { kind: "execution", id: createCruxRunId() },
          { role: "verification", cursor },
        ),
      ).rejects.toMatchObject({
        code: "EVIDENCE_CURSOR_INVALID",
      });
    },
  );

  it("accepts the approved inclusive string bounds", async () => {
    const result = await flow("evidence-inclusive-bounds", async (scope) =>
      scope.step("record", async () => {
        const ref = evidence.record({
          role: "verification",
          kind: `custom.${"k".repeat(121)}`,
          data: {},
          idempotencyKey: "i".repeat(256),
        });
        return evidence.inspect(ref.subject, {
          role: "verification",
          limit: 50,
        });
      }),
    ).run();

    expect(result.status).toBe("completed");
  });
});
