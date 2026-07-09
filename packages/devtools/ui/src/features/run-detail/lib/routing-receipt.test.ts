import { describe, expect, it } from "vitest";
import type { CruxRoutingReportPreview } from "@use-crux/core/observability";
import { routingFactsFromReport, routingStepViews } from "./routing-receipt";

describe("routing receipt adapter", () => {
  it("projects canonical receipt trace rows for all routing primitives", () => {
    const report: CruxRoutingReportPreview = {
      model: "openai/gpt-5",
      trace: [
        {
          kind: "router",
          classifiedAs: "unknown",
          route: "default",
          usedDefaultRoute: true,
          forced: false,
        },
        { kind: "split", route: "beta", seed: "tenant-42" },
        {
          kind: "retry",
          model: "fast-model",
          attempts: [
            {
              model: "fast-model",
              status: "error",
              durationMs: 25,
              errorCategory: "timeout",
              delayMs: 50,
            },
            { model: "fast-model", status: "ok", durationMs: 30, cost: 0.03 },
          ],
        },
        {
          kind: "fallback",
          midStreamFailure: true,
          attempts: [
            {
              model: "fast-model",
              status: "error",
              durationMs: 35,
              errorCategory: "provider_error",
            },
            { model: "openai/gpt-5", status: "ok", durationMs: 80, cost: 0.2 },
          ],
        },
        {
          kind: "cascade",
          acceptedAtTier: 1,
          budgetExceeded: true,
          tiers: [
            {
              tier: 0,
              model: "cheap",
              status: "rejected",
              durationMs: 20,
              confidence: 0.62,
            },
            {
              tier: 1,
              model: "openai/gpt-5",
              status: "accepted",
              durationMs: 60,
              judgeCost: 0.04,
            },
          ],
        },
      ],
    };

    expect(routingStepViews(report)).toMatchObject([
      { kind: "router", route: "default", usedDefaultRoute: true },
      { kind: "split", route: "beta", seed: "tenant-42" },
      { kind: "retry", attempts: [{ status: "error" }, { status: "ok" }] },
      {
        kind: "fallback",
        midStreamFailure: true,
        attempts: [{ status: "error" }, { status: "ok" }],
      },
      {
        kind: "cascade",
        acceptedAtTier: 1,
        budgetExceeded: true,
        tiers: [{ status: "rejected" }, { status: "accepted" }],
      },
    ]);
  });

  it("derives inspector facts from the same canonical receipt", () => {
    const report: CruxRoutingReportPreview = {
      model: "openai/gpt-5",
      trace: [
        {
          kind: "router",
          classifiedAs: "default",
          route: "default",
          usedDefaultRoute: true,
          forced: false,
        },
        {
          kind: "fallback",
          midStreamFailure: true,
          attempts: [{ model: "openai/gpt-5", status: "ok", durationMs: 80 }],
        },
        {
          kind: "cascade",
          acceptedAtTier: 1,
          budgetExceeded: true,
          tiers: [
            { tier: 0, model: "cheap", status: "rejected" },
            { tier: 1, model: "openai/gpt-5", status: "accepted" },
          ],
        },
      ],
    };

    expect(routingFactsFromReport(report, { maxCost: 0.5 })).toMatchObject({
      chosen: "openai/gpt-5",
      classifiedAs: "default",
      tiers: 2,
      escalated: 1,
      underBudget: false,
      budget: 0.5,
      hasDefaultRoute: true,
      hasMidStreamFailure: true,
      why: "accepted at tier 2 of 2; escalated 1.",
    });
  });
});
