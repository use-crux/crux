import { afterEach, describe, expect, it } from "vitest";
import {
  createCruxArtifactId,
  createInMemoryObservabilityTransport,
  evidence,
  flow,
  observe,
  observabilityDiagnostics,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../../src";

describe("evidence graph projection", () => {
  afterEach(() => {
    resetObservabilityRuntime();
  });

  it("emits an inline artifact before a source-to-subject evidence edge", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    const result = await flow("evidence-projection", async (scope) =>
      scope.step("record", () =>
        evidence.record({
          role: "verification",
          conclusion: "passed",
          kind: "custom.editorial-review",
          data: { approved: true },
        }),
      ),
    ).run();
    await observe.flush();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    const artifactIndex = transport.records.findIndex(
      (record) =>
        record.type === "artifact" &&
        record.kind === "custom.editorial-review",
    );
    const edgeIndex = transport.records.findIndex(
      (record) => record.type === "edge" && record.edgeType === "evidence.for",
    );
    expect(artifactIndex).toBeGreaterThan(-1);
    expect(edgeIndex).toBeGreaterThan(artifactIndex);

    const artifact = transport.records[artifactIndex];
    const edge = transport.records[edgeIndex];
    expect(artifact).toMatchObject({
      type: "artifact",
      encoding: "json",
      preview: { approved: true },
      attributes: {
        evidenceSource: {
          evidenceId: result.output.id,
          captureState: "available",
        },
      },
    });
    expect(edge).toMatchObject({
      type: "edge",
      from: {
        kind: "artifact",
        id:
          artifact?.type === "artifact" ? artifact.artifactId : undefined,
      },
      to: {
        kind: "span",
        id: result.output.subject.id,
      },
      attributes: {
        evidenceId: result.output.id,
        role: "verification",
        evidenceKind: "custom.editorial-review",
        conclusion: "passed",
        captureState: "available",
        sourceMode: "inline",
        producer: {
          kind: "span",
          id: result.output.subject.id,
        },
      },
    });
    expect(
      new Set([
        result.output.id,
        artifact?.recordId,
        artifact?.type === "artifact" ? artifact.artifactId : undefined,
        edge?.recordId,
        edge?.type === "edge" ? edge.edgeId : undefined,
      ]).size,
    ).toBe(5);
  });

  it("emits only an edge when linking an existing source", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const source = {
      kind: "artifact",
      id: createCruxArtifactId(),
    } as const;

    const result = await flow("referenced-evidence-projection", async (scope) =>
      scope.step("record", () =>
        evidence.record({
          role: "verification",
          conclusion: "passed",
          ref: source,
          kind: "score.report",
        }),
      ),
    ).run();
    await observe.flush();

    expect(result.status).toBe("completed");
    expect(
      transport.records.some(
        (record) =>
          record.type === "artifact" && record.artifactId === source.id,
      ),
    ).toBe(false);
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "edge",
        edgeType: "evidence.for",
        from: source,
        attributes: expect.objectContaining({
          captureState: "reference",
          sourceMode: "reference",
        }),
      }),
    );
  });

  it("uses the active run as producer when no span is active", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const source = {
      kind: "artifact",
      id: createCruxArtifactId(),
    } as const;
    const run = observe.openRun({
      name: "run-authored evidence",
      rootPrimitive: "custom.operation",
    });

    run.withContext(() => {
      evidence.record({
        role: "intent",
        ref: source,
        kind: "custom.plan",
      });
    });
    run.end();
    await observe.flush();

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "edge",
        edgeType: "evidence.for",
        to: { kind: "run", id: run.runId },
        attributes: expect.objectContaining({
          producer: { kind: "run", id: run.runId },
        }),
      }),
    );
  });

  it("opens an implicit evidence.record context for an explicit late subject", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const subject = {
      kind: "artifact",
      id: createCruxArtifactId(),
    } as const;

    const ref = evidence.record({
      subject,
      role: "verification",
      conclusion: "passed",
      kind: "custom.late-review",
      data: { approved: true },
    });
    await observe.flush();

    expect(ref.subject).toEqual(subject);
    expect(transport.records.map((record) => record.type)).toEqual([
      "run:start",
      "span:start",
      "artifact",
      "edge",
      "span:end",
      "run:end",
    ]);
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "run:start",
        rootPrimitive: "evidence.record",
      }),
    );
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "span:start",
        primitive: "evidence.record",
      }),
    );
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "edge",
        edgeType: "evidence.for",
        to: subject,
      }),
    );
  });

  it("rejects an unresolved receipt before collector or graph emission", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    expect(() =>
      evidence.record({
        subject: {
          kind: "effect.receipt",
          id: "provider-receipt",
          effectId: "cms.publish",
        },
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
    await observe.flush();

    expect(transport.records).toEqual([]);
  });

  it("keeps local acceptance stable when delivery rejects every record", async () => {
    setObservabilityTransport({
      send(records) {
        return {
          dispositions: records.map((record, index) => ({
            index,
            recordId: record.recordId,
            outcome: "rejected" as const,
            code: "destination_rejected",
            retryable: false,
          })),
        };
      },
    });

    const result = await flow("failed-evidence-delivery", async (scope) =>
      scope.step("record", async () => {
        const ref = evidence.record({
          role: "verification",
          conclusion: "passed",
          kind: "custom.local-check",
          data: { passed: true },
        });
        return {
          ref,
          view: await evidence.inspect(ref.subject),
        };
      }),
    ).run();
    await observe.flush();

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.output.view.roles.verification.records[0]?.ref).toBe(
      result.output.ref,
    );
    expect(observabilityDiagnostics()).toMatchObject({
      permanentlyRejectedRecords: expect.any(Number),
      invalidRecords: 0,
    });
    expect(
      observabilityDiagnostics().permanentlyRejectedRecords,
    ).toBeGreaterThan(0);
  });
});
