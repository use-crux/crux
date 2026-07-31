import { describe, expect, it } from "vitest";
import fixture from "../../src/observability/fixtures/effect-v5.json";
import {
  CRUX_CANONICAL_ARTIFACT_KINDS,
  CRUX_CANONICAL_EDGE_TYPES,
  CRUX_PRIMITIVE_FAMILIES,
  CRUX_PRIMITIVE_FAMILY_BY_NAME,
  CRUX_PRIMITIVE_NAMES,
  CruxArtifactRecordSchema,
  CruxEdgeRecordSchema,
  CruxGraphRecordBatchSchema,
  CruxSpanStartRecordSchema,
} from "../../src/observability";

describe("effect observability schema v5 conformance", () => {
  it("maps effect.run to the effect family without changing schema version", () => {
    expect(CRUX_PRIMITIVE_FAMILIES).toContain("effect");
    expect(CRUX_PRIMITIVE_NAMES).toContain("effect.run");
    expect(CRUX_PRIMITIVE_FAMILY_BY_NAME["effect.run"]).toBe("effect");

    expect(
      CruxSpanStartRecordSchema.safeParse({
        schemaVersion: 5,
        recordId: "rec_effect_taxonomy",
        type: "span:start",
        operationId: "run_effect_taxonomy",
        runId: "run_effect_taxonomy",
        segmentId: "seg_effect_taxonomy",
        segmentSeq: 1,
        spanId: "1111111111111111",
        family: "effect",
        primitive: "effect.run",
        name: "crm.customer.update",
        startedAt: "2026-07-31T12:00:00.000Z",
        status: "running",
        attributes: {
          "crux.effect.id": "crm.customer.update",
          "crux.effect.version": 1,
          "crux.effect.receipt.id": "effect_receipt_1",
          "crux.effect.scope.id": "scope_1",
          "crux.effect.boundary.id": "boundary_1",
          "crux.effect.outcome": "preparing",
          "crux.effect.recovery": "unavailable",
        },
      }).success,
    ).toBe(true);
  });

  it("requires canonical attributes only on the new effect.run primitive", () => {
    const record = {
      schemaVersion: 5,
      recordId: "rec_effect_attributes",
      type: "span:start",
      operationId: "run_effect_taxonomy",
      runId: "run_effect_taxonomy",
      segmentId: "seg_effect_taxonomy",
      segmentSeq: 1,
      spanId: "1111111111111111",
      family: "effect",
      primitive: "effect.run",
      name: "crm.customer.update",
      startedAt: "2026-07-31T12:00:00.000Z",
      status: "running",
    } as const;

    expect(CruxSpanStartRecordSchema.safeParse(record).success).toBe(false);
    expect(
      CruxSpanStartRecordSchema.safeParse({
        ...record,
        family: "custom",
        primitive: "custom.operation",
      }).success,
    ).toBe(true);
  });

  it("accepts a qualified receipt summary and recovery relationship", () => {
    expect(CRUX_CANONICAL_ARTIFACT_KINDS).toContain("effect.receipt");
    expect(CRUX_CANONICAL_EDGE_TYPES).toContain("recovery.of");

    expect(
      CruxArtifactRecordSchema.safeParse({
        schemaVersion: 5,
        recordId: "rec_effect_receipt",
        type: "artifact",
        operationId: "run_effect_taxonomy",
        runId: "run_effect_taxonomy",
        segmentId: "seg_effect_taxonomy",
        segmentSeq: 2,
        artifactId: "artifact_effect_receipt",
        spanId: "1111111111111111",
        kind: "effect.receipt",
        createdAt: "2026-07-31T12:00:01.000Z",
        contentType: "application/json",
        encoding: "json",
        preview: {
          kind: "effect.receipt",
          receiptId: "effect_receipt_1",
          effectId: "crm.customer.update",
          effectVersion: 1,
          scopeId: "scope_1",
          boundaryId: "boundary_1",
          outcome: "succeeded",
          recovery: "available",
          resource: {
            type: "crm.customer",
            id: "customer_1",
          },
        },
      }).success,
    ).toBe(true);

    expect(
      CruxEdgeRecordSchema.safeParse({
        schemaVersion: 5,
        recordId: "rec_recovery_of",
        type: "edge",
        operationId: "run_effect_taxonomy",
        runId: "run_effect_taxonomy",
        segmentId: "seg_effect_taxonomy",
        segmentSeq: 3,
        edgeId: "edge_recovery_of",
        edgeType: "recovery.of",
        from: { kind: "span", id: "2222222222222222" },
        to: { kind: "span", id: "1111111111111111" },
        createdAt: "2026-07-31T12:00:02.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects envelope data and non-span recovery relationships", () => {
    const artifact = {
      schemaVersion: 5,
      recordId: "rec_effect_receipt_private",
      type: "artifact",
      operationId: "run_effect_taxonomy",
      runId: "run_effect_taxonomy",
      segmentId: "seg_effect_taxonomy",
      segmentSeq: 2,
      artifactId: "artifact_effect_receipt_private",
      kind: "effect.receipt",
      createdAt: "2026-07-31T12:00:01.000Z",
      contentType: "application/json",
      encoding: "json",
      preview: {
        kind: "effect.receipt",
        receiptId: "effect_receipt_1",
        effectId: "crm.customer.update",
        effectVersion: 1,
        scopeId: "scope_1",
        boundaryId: "boundary_1",
        outcome: "succeeded",
        recovery: "available",
        input: { token: "secret" },
      },
    } as const;

    expect(CruxArtifactRecordSchema.safeParse(artifact).success).toBe(false);
    expect(
      CruxEdgeRecordSchema.safeParse({
        schemaVersion: 5,
        recordId: "rec_recovery_of_artifact",
        type: "edge",
        operationId: "run_effect_taxonomy",
        runId: "run_effect_taxonomy",
        segmentId: "seg_effect_taxonomy",
        segmentSeq: 3,
        edgeId: "edge_recovery_of_artifact",
        edgeType: "recovery.of",
        from: { kind: "artifact", id: "artifact_attempt" },
        to: { kind: "artifact", id: "artifact_original" },
        createdAt: "2026-07-31T12:00:02.000Z",
      }).success,
    ).toBe(false);
  });

  it("accepts the shared execution and recovery privacy fixture", () => {
    expect(CruxGraphRecordBatchSchema.safeParse(fixture).success).toBe(true);
    expect(fixture.records).toContainEqual(
      expect.objectContaining({
        type: "edge",
        edgeType: "recovery.of",
        from: { kind: "span", id: "2222222222222222" },
        to: { kind: "span", id: "1111111111111111" },
      }),
    );
    expect(JSON.stringify(fixture)).not.toMatch(
      /captured|envelope|input|output|secret-token/,
    );
  });
});
