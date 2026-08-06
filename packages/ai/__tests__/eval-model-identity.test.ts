import type { LanguageModel } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { prompt } from "@use-crux/core";
import {
  cascade,
  fallback,
  retry,
  router,
  split,
} from "@use-crux/core/routing";
import { getEvalTaskDescriptorForInternalUse } from "@use-crux/core/eval/internal/task";
import { createCruxAi, aiSdk } from "../src";

const leaf = aiSdk({
  provider: "test",
  modelId: "leaf",
  specificationVersion: "v3",
} as unknown as LanguageModel);

function projectModel(model: unknown) {
  const task = createCruxAi().generate.task(
    prompt({ input: z.object({ text: z.string() }), prompt: "Summarize." }),
    { model: model as never },
  );
  const identity = getEvalTaskDescriptorForInternalUse(task).projectIdentity({
    phase: "plan",
    input: { text: "hello" },
    overrides: {},
  });
  if (!identity.reusable) throw new Error(identity.reason);
  return (identity.fingerprintMaterial as { readonly model: unknown }).model;
}

function projectIdentity(model: unknown) {
  const task = createCruxAi().generate.task(
    prompt({ input: z.object({ text: z.string() }), prompt: "Summarize." }),
    { model: model as never },
  );
  return getEvalTaskDescriptorForInternalUse(task).projectIdentity({
    phase: "plan",
    input: { text: "hello" },
    overrides: {},
  });
}

describe("routable model identity", () => {
  it("recursively projects a retry wrapper and its complete options", () => {
    expect(
      projectModel(
        retry(leaf, {
          id: "retry-leaf",
          description: "Retry transient failures",
          attempts: 3,
          backoff: "exponential",
          on: ["rate_limit", "timeout"],
          delayMs: 125,
        }),
      ),
    ).toEqual({
      kind: "retry",
      model: expect.objectContaining({
        contract: "crux.generation-model.v1",
        identity: { kind: "model", model: "test:leaf" },
      }),
      options: {
        id: "retry-leaf",
        description: "Retry transient failures",
        attempts: 3,
        backoff: "exponential",
        on: ["rate_limit", "timeout"],
        delayMs: 125,
      },
    });
  });

  it("fails closed for routing callbacks with mutable closure state", () => {
    let calls = 0;
    let useBackup = true;
    const routed = fallback([leaf, "test/backup"], {
      id: "primary-fallback",
      description: "Use the backup on transient failures",
      on: ["rate_limit"],
      shouldFallback: () => {
        calls += 1;
        return useBackup;
      },
      when: () => {
        calls += 1;
        return false;
      },
      timeout: { attempt: 1_000, firstToken: 250 },
      onFallback: () => {
        calls += 1;
      },
    });

    const first = projectIdentity(routed);
    useBackup = false;
    const second = projectIdentity(routed);

    expect(first).toEqual({
      reusable: false,
      reason: "untracked_external_dependency",
    });
    expect(second).toEqual(first);
    expect(calls).toBe(0);
  });

  it("fails closed for split seed callbacks", () => {
    let seeds = 0;
    const routed = split({
      id: "canary",
      description: "Stable canary assignment",
      seed: () => {
        seeds += 1;
        return "session";
      },
      routes: {
        stable: { model: leaf, weight: 95 },
        canary: { model: retry("test/canary", { attempts: 2 }), weight: 5 },
      },
    });

    expect(projectIdentity(routed)).toEqual({
      reusable: false,
      reason: "untracked_external_dependency",
    });
    expect(seeds).toBe(0);
  });

  it("fails closed for router classification callbacks", () => {
    let classifications = 0;
    const routed = router({
      id: "support-router",
      description: "Choose by support tier",
      classify: () => {
        classifications += 1;
        return "fast" as const;
      },
      routes: {
        fast: { model: leaf, temperature: 0, maxTokens: 128 },
        default: "test/default",
      },
    });

    expect(projectIdentity(routed)).toEqual({
      reusable: false,
      reason: "untracked_external_dependency",
    });
    expect(classifications).toBe(0);
  });

  it("projects cascade tiers and budgets recursively", () => {
    const routed = cascade({
      id: "quality-cascade",
      description: "Escalate weak answers",
      tiers: [
        {
          model: retry(leaf, { attempts: 2 }),
          escalateOn: ["invalid_response"],
          budget: 0.01,
          note: "fast first",
        },
        { model: "test/deep" },
      ],
      budget: { maxCost: 0.05, maxLatencyMs: 5_000 },
    });

    expect(projectModel(routed)).toEqual({
      kind: "cascade",
      config: {
        id: "quality-cascade",
        description: "Escalate weak answers",
        prompt: null,
        tiers: [
          {
            model: {
              kind: "retry",
              model: expect.objectContaining({
                contract: "crux.generation-model.v1",
                identity: { kind: "model", model: "test:leaf" },
              }),
              options: { attempts: 2 },
            },
            escalateOn: ["invalid_response"],
            budget: 0.01,
            note: "fast first",
          },
          { model: { modelId: "test/deep" } },
        ],
        budget: { maxCost: 0.05, maxLatencyMs: 5_000 },
      },
    });
  });

  it("keeps a route tree fresh when any object leaf is unattested", () => {
    const unattested = {
      provider: "test",
      modelId: "opaque",
      specificationVersion: "v3",
    } as unknown as LanguageModel;

    expect(projectIdentity(retry(unattested, { attempts: 2 }))).toEqual({
      reusable: false,
      reason: "model_identity_unattested",
    });
  });

  it("includes a cascade-bound prompt in the route-tree identity", () => {
    const boundPrompt = prompt({
      id: "cascade-prompt",
      input: z.object({ text: z.string() }),
      system: "Judge the answer.",
      prompt: "Judge the answer.",
    });
    const routed = cascade({
      prompt: boundPrompt,
      tiers: [{ model: leaf }],
    });

    expect(projectModel(routed)).toMatchObject({
      kind: "cascade",
      config: {
        prompt: {
          id: "cascade-prompt",
          content: {
            system: "Judge the answer.",
            prompt: "Judge the answer.",
          },
        },
      },
    });
  });

  it("includes the resolved model target in observed route identity", () => {
    const routed = retry(leaf, { attempts: 2 });
    const task = createCruxAi().generate.task(
      prompt({ input: z.object({ text: z.string() }), prompt: "Answer." }),
      { model: routed },
    );
    const descriptor = getEvalTaskDescriptorForInternalUse(task);
    const request = { input: { text: "hello" }, overrides: {} } as const;
    const planned = descriptor.projectIdentity({ phase: "plan", ...request });
    const observed = descriptor.projectIdentity({
      phase: "observed",
      ...request,
      result: { finalStep: { modelId: "leaf" } },
    });
    const otherRoute = descriptor.projectIdentity({
      phase: "observed",
      ...request,
      result: { finalStep: { modelId: "backup" } },
    });

    expect(observed).toMatchObject({
      reusable: true,
      fingerprintMaterial: {
        model: { kind: "retry", resolvedModelId: "leaf" },
      },
    });
    expect(observed).not.toEqual(planned);
    expect(otherRoute).not.toEqual(observed);
  });
});
