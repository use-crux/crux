import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ObservabilityRunDetailNode } from "@/types";
import {
  isTransportEnvelopeDetail,
  TransportEnvelopeCard,
} from "./TransportEnvelopeCard";

describe("TransportEnvelopeCard", () => {
  it("detects transport envelope attributes on custom.operation", () => {
    expect(isTransportEnvelopeDetail(sampleNode())).toBe(true);
  });

  it("renders binding identity and Signal lineage without payloads", () => {
    const html = renderToStaticMarkup(
      <TransportEnvelopeCard node={sampleNode()} />,
    );
    expect(html).toContain("Transport envelope");
    expect(html).toContain("binding.orders");
    expect(html).toContain("order.submitted");
    expect(html).toContain("occ_1");
    expect(html).not.toMatch(/payload|secret|base64/i);
  });
});

function sampleNode(): ObservabilityRunDetailNode {
  return {
    id: "span_transport_envelope",
    name: "transport envelope",
    primitive: "custom.operation",
    family: "custom",
    status: "ok",
    attributes: {
      kind: "transport.envelope",
      outcome: "normalized",
      envelope: {
        namespace: "demo",
        provider: "orders",
        accountId: "acct_1",
        eventId: "evt_1",
        bindingId: "binding.orders",
        adapterId: "adapter.orders",
        state: "normalized",
        attempts: 1,
        maxAttempts: 5,
        acceptedAt: "2026-08-08T12:00:00.000Z",
        updatedAt: "2026-08-08T12:00:01.000Z",
        nextAttemptAt: "2026-08-08T12:00:01.000Z",
        lineage: [{ signalId: "order.submitted", occurrenceId: "occ_1" }],
        lineageTruncated: false,
        configRefId: "cfg.orders",
        configRefRevision: "1",
        targetSignalId: "order.submitted",
      },
    },
  } as unknown as ObservabilityRunDetailNode;
}
