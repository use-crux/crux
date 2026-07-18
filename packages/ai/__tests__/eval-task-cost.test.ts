import { describe, expect, it } from "vitest";
import { z } from "zod";

import { fallback, prompt } from "@use-crux/core";
import { getEvalTaskDescriptorForInternalUse } from "@use-crux/core/eval/internal/task";
import { cascade, router, split } from "@use-crux/core/routing";
import { createCruxAi } from "../src";

describe("managed AI Eval cost ceilings", () => {
  it("normalizes model keys and multiplies a per-call ceiling by maxSteps", () => {
    const task = createCruxAi().generate.task(
      prompt({ input: z.object({}), prompt: "Answer." }),
      { model: "openai/gpt-5:2026", maxSteps: 3 },
    );
    const estimate = getEvalTaskDescriptorForInternalUse(task).estimateCost;

    expect(
      estimate?.({
        actionId: "task",
        kind: "task",
        caseId: "case",
        variant: "current",
        trial: 0,
        task,
        overrides: {},
        input: {},
        pricing: { "gpt-5": { maxUsdPerCall: 0.25 } },
      }),
    ).toEqual({
      kind: "known",
      maximumUsd: 0.75,
      source: "config_override",
    });
  });

  it("takes the maximum selectable route and sums fallback and cascade calls", () => {
    const routed = router({
      classify: () => "resilient" as const,
      routes: {
        fast: "fast",
        resilient: fallback([
          "backup",
          cascade({ tiers: [{ model: "small" }, { model: "large" }] }),
        ]),
        default: split({
          seed: () => "stable",
          routes: {
            cheap: { model: "cheap", weight: 1 },
            premium: { model: "premium", weight: 1 },
          },
        }),
      },
    });
    const task = createCruxAi().generate.task(
      prompt({ input: z.object({}), prompt: "Answer." }),
      { model: routed, maxSteps: 1 },
    );
    const estimate = getEvalTaskDescriptorForInternalUse(task).estimateCost;

    expect(
      estimate?.({
        actionId: "task",
        kind: "task",
        caseId: "case",
        variant: "current",
        trial: 0,
        task,
        overrides: {},
        input: {},
        pricing: {
          fast: { maxUsdPerCall: 0.25 },
          backup: { maxUsdPerCall: 0.5 },
          small: { maxUsdPerCall: 0.75 },
          large: { maxUsdPerCall: 1 },
          cheap: { maxUsdPerCall: 0.2 },
          premium: { maxUsdPerCall: 1.5 },
        },
      }),
    ).toMatchObject({ kind: "known", maximumUsd: 2.25 });
  });

  it("reports every missing normalized pricing key with an actionable remedy", () => {
    const task = createCruxAi().generate.task(
      prompt({ input: z.object({}), prompt: "Answer." }),
      { model: fallback(["openai/small:2026", "anthropic/large:2026"]) },
    );
    const estimate = getEvalTaskDescriptorForInternalUse(task).estimateCost;

    expect(
      estimate?.({
        actionId: "task",
        kind: "task",
        caseId: "case",
        variant: "current",
        trial: 0,
        task,
        overrides: {},
        input: {},
        pricing: { small: { maxUsdPerCall: 0.25 } },
      }),
    ).toEqual({
      kind: "unknown",
      source: "unknown",
      missingPricingKeys: ["large"],
      remedy:
        "Add experimental.eval.pricing entries with maxUsdPerCall for: large; or add a default ceiling.",
    });
  });

  it("returns unknown for effectful cascade evaluation callbacks", () => {
    const task = createCruxAi().generate.task(
      prompt({ input: z.object({}), prompt: "Answer." }),
      {
        model: cascade({
          tiers: [
            { model: "small", evaluate: async () => true },
            { model: "large" },
          ],
        }),
      },
    );
    const estimate = getEvalTaskDescriptorForInternalUse(task).estimateCost;

    expect(
      estimate?.({
        actionId: "task",
        kind: "task",
        caseId: "case",
        variant: "current",
        trial: 0,
        task,
        overrides: {},
        input: {},
        pricing: { default: { maxUsdPerCall: 1 } },
      }),
    ).toEqual({
      kind: "unknown",
      source: "unknown",
      missingPricingKeys: [],
      remedy:
        "Use a supported inert model/routing tree with a finite maxSteps bound.",
    });
  });

  it("uses the same ceiling estimator for streaming tasks", () => {
    const task = createCruxAi().stream.task(
      prompt({ input: z.object({}), prompt: "Answer." }),
      { model: "provider/model", maxSteps: 2 },
    );

    expect(
      getEvalTaskDescriptorForInternalUse(task).estimateCost?.({
        actionId: "task",
        kind: "task",
        caseId: "case",
        variant: "current",
        trial: 0,
        task,
        overrides: {},
        input: {},
        pricing: { model: { maxUsdPerCall: 0.5 } },
      }),
    ).toMatchObject({ kind: "known", maximumUsd: 1 });
  });

  it("prices an admitted managed judge as one call to its effective model", () => {
    const task = createCruxAi().generate.task(
      prompt({ input: z.object({}), prompt: "Answer." }),
      { model: "task-model", maxSteps: 10 },
    );

    expect(
      getEvalTaskDescriptorForInternalUse(task).estimateCost?.({
        actionId: "judge",
        kind: "scorer",
        scorerName: "helpful",
        caseId: "case",
        variant: "current",
        trial: 0,
        task,
        overrides: {},
        input: {},
        billingModel: "judge-model",
        inheritTaskModel: true,
        pricing: {
          "task-model": { maxUsdPerCall: 1 },
          "judge-model": { maxUsdPerCall: 0.4 },
        },
      }),
    ).toEqual({
      kind: "known",
      maximumUsd: 0.4,
      source: "config_override",
    });
  });
});
