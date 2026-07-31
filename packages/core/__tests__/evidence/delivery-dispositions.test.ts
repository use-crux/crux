import { afterEach, describe, expect, it } from "vitest";
import {
  evidence,
  flow,
  observe,
  observabilityDiagnostics,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../../src";
import type { CruxDeliveryReceipt } from "../../src/observability";
import { createDeliveryEngine } from "../../src/observability/delivery/engine";

describe("evidence delivery dispositions", () => {
  afterEach(() => {
    resetObservabilityRuntime();
  });

  it("preserves a permanent durable conflict and safe evidence correlation", async () => {
    let evidenceId: string | undefined;
    setObservabilityTransport(
      {
        send(records) {
          return {
            dispositions: records.map((record, index) => {
              const conflict =
                record.type === "edge" && record.edgeType === "evidence.for";
              return {
                index,
                recordId: record.recordId,
                outcome: conflict
                  ? ("rejected" as const)
                  : ("accepted" as const),
                code: conflict ? "EVIDENCE_IDEMPOTENCY_CONFLICT" : "accepted",
                retryable: false as const,
                ...(conflict
                  ? { message: "SECRET winning digest and key" }
                  : {}),
              };
            }),
          };
        },
      },
      { scheduledDelayMs: 60_000 },
    );

    const result = await flow("durable-conflict", async (scope) =>
      scope.step("record", () => {
        const ref = evidence.record({
          role: "verification",
          conclusion: "passed",
          kind: "custom.durable-review",
          data: { approved: true },
          idempotencyKey: "raw-private-key",
        });
        evidenceId = ref.id;
      }),
    ).run();
    const flushed = await observe.flush();

    expect(result.status).toBe("completed");
    expect(flushed).toMatchObject({
      status: "drained",
      rejected: 1,
      remaining: 0,
    });
    expect(observabilityDiagnostics().deliveryErrors).toContainEqual(
      expect.objectContaining({
        code: "EVIDENCE_IDEMPOTENCY_CONFLICT",
        evidenceIds: [evidenceId],
      }),
    );
    expect(
      JSON.stringify(observabilityDiagnostics().deliveryErrors),
    ).not.toMatch(/SECRET|raw-private-key|contentDigest|subject/u);
  });

  it("preserves retryable staging capacity before a successful retry", async () => {
    let rejectedOnce = false;
    let evidenceId: string | undefined;
    setObservabilityTransport(
      {
        send(records) {
          return {
            dispositions: records.map((record, index) => {
              const retry =
                !rejectedOnce &&
                record.type === "artifact" &&
                record.attributes?.evidenceSource !== undefined;
              if (retry) rejectedOnce = true;
              return {
                index,
                recordId: record.recordId,
                outcome: retry ? ("rejected" as const) : ("accepted" as const),
                code: retry ? "EVIDENCE_STAGING_CAPACITY" : "accepted",
                retryable: retry,
              };
            }),
            retryAfterMs: 1,
          };
        },
      },
      {
        scheduledDelayMs: 60_000,
        retryDelayMs: 1,
        maxRetryDelayMs: 1,
        random: () => 0.5,
      },
    );

    const result = await flow("staging-capacity", async (scope) =>
      scope.step("record", () => {
        evidenceId = evidence.record({
          role: "verification",
          conclusion: "passed",
          kind: "custom.staged-review",
          data: { approved: true },
          idempotencyKey: "staged-private-key",
        }).id;
      }),
    ).run();
    const flushed = await observe.flush();

    expect(result.status).toBe("completed");
    expect(flushed).toMatchObject({
      status: "drained",
      rejected: 0,
      remaining: 0,
    });
    expect(observabilityDiagnostics().deliveryErrors).toContainEqual(
      expect.objectContaining({
        code: "EVIDENCE_STAGING_CAPACITY",
        evidenceIds: [evidenceId],
      }),
    );
  });

  it("preserves a permanent oversized-candidate disposition", async () => {
    let evidenceId: string | undefined;
    setObservabilityTransport(
      {
        send(records) {
          return {
            dispositions: records.map((record, index) => {
              const oversized =
                record.type === "artifact" &&
                record.attributes?.evidenceSource !== undefined;
              return {
                index,
                recordId: record.recordId,
                outcome: oversized
                  ? ("rejected" as const)
                  : ("accepted" as const),
                code: oversized
                  ? "EVIDENCE_STAGING_CANDIDATE_TOO_LARGE"
                  : "accepted",
                retryable: false as const,
              };
            }),
          };
        },
      },
      { scheduledDelayMs: 60_000 },
    );

    const result = await flow("oversized-candidate", async (scope) =>
      scope.step("record", () => {
        evidenceId = evidence.record({
          role: "verification",
          conclusion: "passed",
          kind: "custom.oversized-review",
          data: { marker: "bounded-test" },
          idempotencyKey: "oversized-private-key",
        }).id;
      }),
    ).run();
    const flushed = await observe.flush();

    expect(result.status).toBe("completed");
    expect(flushed).toMatchObject({
      status: "drained",
      rejected: 1,
      remaining: 0,
    });
    expect(observabilityDiagnostics().deliveryErrors).toContainEqual(
      expect.objectContaining({
        code: "EVIDENCE_STAGING_CANDIDATE_TOO_LARGE",
        evidenceIds: [evidenceId],
      }),
    );
  });

  it("preserves an exact evidence conflict from a superseded transport", async () => {
    let settle!: (receipt: CruxDeliveryReceipt) => void;
    const engine = createDeliveryEngine();
    engine.configureDelivery({ scheduledDelayMs: 0 });
    engine.setTransport({
      send: () =>
        new Promise<CruxDeliveryReceipt>((resolve) => {
          settle = resolve;
        }),
    });
    const record = {
      schemaVersion: 5,
      recordId: "rec_stale_evidence",
      type: "edge",
      operationId: "run_stale_evidence",
      runId: "run_stale_evidence",
      segmentId: "seg_stale_evidence",
      segmentSeq: 1,
      edgeId: "edge_stale_evidence",
      edgeType: "evidence.for",
      from: { kind: "artifact", id: "artifact_stale_evidence" },
      to: { kind: "span", id: "1111111111111111" },
      createdAt: "2026-07-29T00:00:00.000Z",
      attributes: {
        evidenceId: "evidence_2222222222222222",
        role: "verification",
        evidenceKind: "score.report",
        conclusion: "passed",
        recordedAt: "2026-07-29T00:00:00.000Z",
        producer: { kind: "span", id: "1111111111111111" },
        captureState: "reference",
        sourceMode: "reference",
      },
    } as const;

    engine.enqueue(record);
    engine.setTransport({ send: () => ({}) });
    settle({
      dispositions: [
        {
          index: 0,
          recordId: record.recordId,
          outcome: "rejected",
          code: "EVIDENCE_IDEMPOTENCY_CONFLICT",
          retryable: false,
        },
      ],
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(engine.errors()).toContainEqual(
      expect.objectContaining({
        code: "EVIDENCE_IDEMPOTENCY_CONFLICT",
        evidenceIds: ["evidence_2222222222222222"],
      }),
    );
  });
});
