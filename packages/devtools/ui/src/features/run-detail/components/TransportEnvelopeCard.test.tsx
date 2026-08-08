import type {
  CruxRunId,
  CruxSpanId,
  CruxTraceId,
} from "@use-crux/core/observability";
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

  it("rejects non-custom primitives that carry transport envelope attributes", () => {
    const node = sampleNode({
      primitive: "thread.append",
      family: "thread",
      name: "thread append",
    });
    expect(node.attributes?.kind).toBe("transport.envelope");
    expect(isTransportEnvelopeDetail(node)).toBe(false);
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

function sampleNode(
  overrides: Partial<
    Pick<ObservabilityRunDetailNode, "primitive" | "family" | "name">
  > = {},
): ObservabilityRunDetailNode {
  const startedAt = "2026-08-08T12:00:00.000Z";
  const endedAt = "2026-08-08T12:00:01.000Z";
  const spanId = "span_transport_envelope" as CruxSpanId;
  const runId = "run_transport_envelope" as CruxRunId;
  const traceId = "trace_transport_envelope" as CruxTraceId;

  return {
    spanId,
    runId,
    traceId,
    parentSpanId: "",
    family: overrides.family ?? "custom",
    primitive: overrides.primitive ?? "custom.operation",
    name: overrides.name ?? "transport envelope",
    status: "ok",
    startedAt,
    endedAt,
    durationMs: 1_000,
    model: "",
    provider: "",
    id: "span_transport_envelope",
    virtual: false,
    parentId: "",
    path: ["span_transport_envelope"],
    kind: "operation",
    display: {
      kind: "operation",
      label: overrides.name ?? "transport envelope",
    },
    timing: {
      startedAt,
      endedAt,
      durationMs: 1_000,
    },
    metricBuckets: {},
    source: {
      placementReason: "primary",
    },
    details: [],
    artifacts: [],
    events: [],
    relations: [],
    diagnostics: [],
    children: [],
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
        acceptedAt: startedAt,
        updatedAt: endedAt,
        nextAttemptAt: endedAt,
        lineage: [{ signalId: "order.submitted", occurrenceId: "occ_1" }],
        lineageTruncated: false,
        configRefId: "cfg.orders",
        configRefRevision: "1",
        targetSignalId: "order.submitted",
      },
    },
  } satisfies ObservabilityRunDetailNode;
}
