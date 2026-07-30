import { describe, expect, it } from "vitest";
import fixture from "../../src/observability/fixtures/evidence-v5.json";
import {
  CRUX_OBSERVABILITY_SCHEMA_VERSION,
  CruxGraphRecordBatchSchema,
} from "../../src/observability";

describe("observability schema v5 evidence conformance", () => {
  it("accepts the shared evidence span and qualified edge fixture", () => {
    expect(CRUX_OBSERVABILITY_SCHEMA_VERSION).toBe(5);

    const parsed = CruxGraphRecordBatchSchema.parse(fixture);
    expect(parsed.records).toHaveLength(3);
    expect(
      parsed.records.every((record) => record.schemaVersion === 5),
    ).toBe(true);
    expect(parsed.records[1]).toMatchObject({
      type: "edge",
      edgeType: "evidence.for",
      attributes: {
        role: "verification",
        conclusion: "passed",
      },
    });
    expect(parsed.records[2]).toMatchObject({
      type: "span:event",
      name: "evidence.coverage",
      attributes: {
        role: "recovery",
        status: "not-applicable",
      },
    });
  });
});
