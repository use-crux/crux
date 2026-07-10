import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CruxRoutingReportPreview } from "@use-crux/core/observability";
import type { ObservabilityRunDetailNode } from "@/types";
import { GovernanceTab } from "./GenerationDecisions";
import { OperationReportFor } from "./PrimitiveCards";
import { isRoutingReportPreview } from "../lib/routing-receipt";

const receipt = {
  model: "model-b",
  cost: 0.02,
  firstTokenAt: 218,
  trace: [
    {
      kind: "router",
      id: "tier",
      classifiedAs: "resilient",
      route: "resilient",
      usedDefaultRoute: false,
      forced: false,
    },
    {
      kind: "fallback",
      id: "recovery",
      firstTokenAt: 218,
      attempts: [
        {
          model: "model-a",
          status: "error",
          durationMs: 10,
          errorCategory: "rate_limit",
          error: "rate limited after the gateway exhausted its retry budget",
          delayMs: 50,
        },
        { model: "model-b", status: "ok", durationMs: 11, cost: 0.02 },
      ],
    },
    {
      kind: "cascade",
      id: "quality",
      acceptedAtTier: 1,
      budgetExceeded: true,
      tiers: [
        {
          tier: 0,
          model: "model-b",
          status: "rejected",
          durationMs: 11,
          confidence: 0.62,
          judgeCost: 0.002,
          budget: 0.05,
          note: "quality below the launch threshold",
        },
        { tier: 1, model: "model-c", status: "accepted", durationMs: 20 },
      ],
    },
  ],
} satisfies CruxRoutingReportPreview;

const generation = {
  id: "span_generation",
  details: [
    {
      status: "ok",
      attributes: {},
      artifacts: [{ kind: "routing.report", preview: receipt }],
    },
  ],
} as unknown as ObservabilityRunDetailNode;

const transportedUnknownCostReceipt = {
  model: "router-primary",
  cost: null,
  firstTokenAt: 0,
  trace: [
    {
      kind: "router",
      classifiedAs: "resilient",
      route: "resilient",
      usedDefaultRoute: false,
      forced: false,
    },
    {
      kind: "fallback",
      firstTokenAt: 0,
      attempts: [
        {
          model: "router-primary",
          status: "ok",
          durationMs: 13,
          cost: null,
        },
      ],
    },
  ],
} satisfies CruxRoutingReportPreview;

const transportedUnknownCostGeneration = {
  id: "span_transport_generation",
  details: [
    {
      status: "ok",
      attributes: {},
      artifacts: [
        { kind: "routing.report", preview: transportedUnknownCostReceipt },
      ],
    },
  ],
} as unknown as ObservabilityRunDetailNode;

describe("GenerationDecisions", () => {
  it("renders a JSON-safe receipt whose unavailable costs are null", () => {
    expect(isRoutingReportPreview(transportedUnknownCostReceipt)).toBe(true);

    const html = renderToStaticMarkup(
      <GovernanceTab node={transportedUnknownCostGeneration} type="routing" />,
    );

    expect(html).toContain("Routing receipt");
    expect(html).toContain("Router");
    expect(html).toContain("Fallback");
    expect(html).toContain("router-primary");
    expect(html).toContain("TTFT 0ms");
    expect(html).not.toContain(
      "No routing decision folded onto this generation.",
    );
  });

  it("renders a canonical outer routing report without an inner kind", () => {
    expect(isRoutingReportPreview(receipt)).toBe(true);

    const html = renderToStaticMarkup(
      <GovernanceTab node={generation} type="routing" />,
    );

    expect(html).toContain("Routing receipt");
    expect(html).toContain("Router");
    expect(html).toContain("Fallback");
    expect(html).toContain("model-b");
    expect(html).toContain("TTFT 218ms");
    expect(html).toContain("rate limited after the gateway exhausted its retry budget");
    expect(html).toContain("delay 50ms");
    expect(html).toContain("quality below the launch threshold");
    expect(html).toContain("rejected 0.62");
    expect(html).toContain("judge $0.0020");
    expect(html).toContain("budget $0.050");
    expect(html).not.toContain("No routing decision folded onto this generation.");
  });

  it("renders the canonical receipt in operation-report cards", () => {
    const html = renderToStaticMarkup(
      <OperationReportFor node={generation} kind="routing.report" />,
    );

    expect(html).toContain("Routing receipt");
    expect(html).toContain("Router");
    expect(html).toContain("Fallback");
  });
});
