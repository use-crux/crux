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
      attempts: [
        {
          model: "model-a",
          status: "error",
          durationMs: 10,
          errorCategory: "rate_limit",
          error: "rate limited",
        },
        { model: "model-b", status: "ok", durationMs: 11, cost: 0.02 },
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

describe("GenerationDecisions", () => {
  it("renders a canonical outer routing report without an inner kind", () => {
    expect(isRoutingReportPreview(receipt)).toBe(true);

    const html = renderToStaticMarkup(
      <GovernanceTab node={generation} type="routing" />,
    );

    expect(html).toContain("Routing receipt");
    expect(html).toContain("Router");
    expect(html).toContain("Fallback");
    expect(html).toContain("model-b");
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
