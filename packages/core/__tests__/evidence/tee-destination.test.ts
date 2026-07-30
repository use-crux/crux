import { describe, expect, it } from "vitest";
import {
  acceptedDeliveryReceipt,
  teeObservabilityTransport,
  type CruxEvidenceQueryDestination,
  type CruxObservabilityTransport,
} from "../../src";

describe("evidence destination transport composition", () => {
  it("preserves zero or one readable destination", () => {
    const capture = transport();
    const readable = destination();
    const local = { ...transport(), evidence: readable };

    expect(teeObservabilityTransport(capture).evidence).toBeUndefined();
    expect(teeObservabilityTransport(capture, local).evidence).toBe(readable);
  });

  it("rejects ambiguous readable destination composition", () => {
    expect(() =>
      teeObservabilityTransport(
        { ...transport(), evidence: destination() },
        { ...transport(), evidence: destination() },
      ),
    ).toThrowError(/at most one readable evidence destination/u);
  });
});

function transport(): CruxObservabilityTransport {
  return {
    send(records) {
      return acceptedDeliveryReceipt(records);
    },
  };
}

function destination(): CruxEvidenceQueryDestination {
  return {
    async inspectEvidence(request) {
      const empty = (role: "intent" | "authority" | "change" | "verification" | "recovery") => ({
        role,
        status: "not-yet-recorded" as const,
        records: [],
        conflicting: false,
        truncated: false,
      });
      return {
        subject: request.subject,
        roles: {
          intent: empty("intent"),
          authority: empty("authority"),
          change: empty("change"),
          verification: empty("verification"),
          recovery: empty("recovery"),
        },
      };
    },
  };
}
