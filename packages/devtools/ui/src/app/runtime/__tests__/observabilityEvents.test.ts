import { describe, expect, it } from "vitest";
import {
  isBlanketInvalidatableObservabilityQueryKey,
  observabilityEventIds,
} from "../observabilityEvents";

describe("observabilityEventIds", () => {
  it("extracts run and trace ids from observability WS events", () => {
    expect(
      observabilityEventIds({
        type: "observability:event",
        event: {
          refId: "run_ref",
          payload: {
            runId: "run_payload",
            traceId: "trace_payload",
            runIds: ["run_deleted"],
            traceIds: ["trace_deleted"],
          },
        },
      }),
    ).toEqual([
      "run_ref",
      "run_payload",
      "trace_payload",
      "run_deleted",
      "trace_deleted",
    ]);
  });

  it("extracts ids from serialized event payloads", () => {
    expect(
      observabilityEventIds({
        refId: "run_ref",
        payload: JSON.stringify({
          runId: "run_payload",
          traceId: "trace_payload",
        }),
      }),
    ).toEqual(["run_ref", "run_payload", "trace_payload"]);
  });
});

describe("isBlanketInvalidatableObservabilityQueryKey", () => {
  it("excludes the revisioned runs-page slice from the blanket WS sweep", () => {
    expect(
      isBlanketInvalidatableObservabilityQueryKey([
        "observability",
        "runs-page",
        { status: undefined },
      ]),
    ).toBe(false);
  });

  it("still sweeps run detail, span events, resource activity, and definition activity", () => {
    expect(
      isBlanketInvalidatableObservabilityQueryKey([
        "observability",
        "run",
        "run_1",
      ]),
    ).toBe(true);
    expect(
      isBlanketInvalidatableObservabilityQueryKey([
        "observability",
        "span-events",
        "run_1",
        "span_1",
        null,
      ]),
    ).toBe(true);
    expect(
      isBlanketInvalidatableObservabilityQueryKey([
        "observability",
        "resource",
        "tool",
      ]),
    ).toBe(true);
    expect(
      isBlanketInvalidatableObservabilityQueryKey([
        "observability",
        "definition-activity",
        "prompt:greeting",
      ]),
    ).toBe(true);
  });

  it("never matches a query key outside the observability prefix", () => {
    expect(
      isBlanketInvalidatableObservabilityQueryKey(["inspect", "runs"]),
    ).toBe(false);
  });
});
