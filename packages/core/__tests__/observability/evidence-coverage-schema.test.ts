import { describe, expect, it } from "vitest";
import { CruxSpanEventRecordSchema } from "../../src/observability";

const event = {
  schemaVersion: 5,
  recordId: "rec_evidence_coverage",
  type: "span:event",
  operationId: "run_evidence_coverage",
  runId: "run_evidence_coverage",
  segmentId: "seg_evidence_coverage",
  segmentSeq: 2,
  spanId: "1111111111111111",
  eventId: "event_evidence_coverage",
  name: "evidence.coverage",
  timestamp: "2026-07-28T12:00:00.000Z",
  attributes: {
    subject: { kind: "span", id: "2222222222222222" },
    role: "verification",
    status: "not-configured",
  },
} as const;

describe("evidence coverage event schema", () => {
  it("accepts the exact qualified event attributes", () => {
    expect(CruxSpanEventRecordSchema.safeParse(event).success).toBe(true);
  });

  it.each([
    {
      name: "missing attributes",
      record: { ...event, attributes: undefined },
    },
    {
      name: "unsupported status",
      record: {
        ...event,
        attributes: { ...event.attributes, status: "not-yet-recorded" },
      },
    },
    {
      name: "effect receipt subject",
      record: {
        ...event,
        attributes: {
          ...event.attributes,
          subject: {
            kind: "effect.receipt",
            id: "receipt",
            effectId: "effect",
          },
        },
      },
    },
    {
      name: "on-behalf producer",
      record: {
        ...event,
        attributes: {
          ...event.attributes,
          producer: { kind: "span", id: "3333333333333333" },
        },
      },
    },
    {
      name: "duplicated observation time",
      record: {
        ...event,
        attributes: {
          ...event.attributes,
          observedAt: event.timestamp,
        },
      },
    },
  ])("rejects $name", ({ record }) => {
    expect(CruxSpanEventRecordSchema.safeParse(record).success).toBe(false);
  });

  it("keeps unrelated span events forward-compatible", () => {
    expect(
      CruxSpanEventRecordSchema.safeParse({
        ...event,
        name: "custom.future-event",
        attributes: {
          future: { nested: true },
        },
      }).success,
    ).toBe(true);
  });
});
