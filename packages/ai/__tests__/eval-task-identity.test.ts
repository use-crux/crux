import type { LanguageModel } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { context, prompt } from "@use-crux/core";
import { router } from "@use-crux/core/routing";
import { evaluate } from "@use-crux/core/eval";
import {
  executeEvalTaskForInternalUse,
  getEvalTaskDescriptorForInternalUse,
} from "@use-crux/core/eval/internal/task";
import { projectDeployedEvalVariants } from "@use-crux/core/runtime/internal/eval-registry";
import { createCruxAi, aiSdk } from "../src";
import { scriptedGateway } from "./scripted-gateway";

const model = {
  provider: "test",
  modelId: "scripted-model",
  specificationVersion: "v3",
} as unknown as LanguageModel;

describe("managed AI task identity", () => {
  it("fails closed when adaptive preparation inputs cannot be projected", () => {
    const task = createCruxAi().generate.task(
      prompt({
        input: z.object({ topic: z.string() }),
        prompt: "Summarize.",
      }),
      {
        model: "test:model",
        prepareStep: () => ({ inputBudget: { max: 1_000 } }),
      },
    );

    expect(
      getEvalTaskDescriptorForInternalUse(task).projectIdentity({
        phase: "plan",
        input: { topic: "refunds" },
        overrides: {},
      }),
    ).toEqual({
      reusable: false,
      reason: "untracked_external_dependency",
    });
  });

  it("changes a deployed arm fingerprint when a projected prompt override changes", () => {
    const task = createCruxAi().generate.task(
      prompt({
        input: z.object({ topic: z.string() }),
        prompt: "Summarize.",
      }),
      { model: "test:model" },
    );
    const fingerprint = (instruction: string) =>
      projectDeployedEvalVariants(
        evaluate({
          id: "summary",
          task,
          cases: [{ input: { topic: "refunds" } }],
          variants: {
            candidate: {
              prompt: prompt({
                input: z.object({ topic: z.string() }),
                prompt: instruction,
              }),
            },
          },
        }),
      )[1]!.fingerprint;

    expect(fingerprint("Be concise.")).not.toBe(fingerprint("Be detailed."));
  });

  it("reuses a frozen model only after aiSdk binding", () => {
    const frozenModel = Object.freeze({
      provider: "test.provider",
      modelId: "stable-model",
      specificationVersion: "v3",
    }) as unknown as LanguageModel;
    const attested = aiSdk(frozenModel);
    const task = createCruxAi().generate.task(
      prompt({
        input: z.object({ topic: z.string() }),
        prompt: "Summarize.",
      }),
      { model: attested },
    );

    expect(attested.native).toBe(frozenModel);
    expect(attested._tag).toBe("crux.generation-model");
    expect(
      getEvalTaskDescriptorForInternalUse(task).projectIdentity({
        phase: "plan",
        input: { topic: "refunds" },
        overrides: {},
      }),
    ).toEqual({
      reusable: true,
      fingerprintMaterial: {
        contract: "crux.ai.eval-task.v2",
        operation: "generate",
        prompt: expect.any(Object),
        model: {
          contract: "crux.generation-model.v1",
          adapter: { id: "ai-sdk", version: "1" },
          definition: {
            id: "ai-sdk:test.provider:stable-model",
            fingerprint: expect.any(String),
          },
          identity: { kind: "model", model: "test.provider:stable-model" },
        },
        options: expect.any(Object),
      },
    });
  });

  it("explains when a model identity cannot be derived", () => {
    const custom = Object.freeze({
      specificationVersion: "v3",
    }) as unknown as LanguageModel;

    expect(() => aiSdk(custom)).toThrow(
      /could not derive a secret-free identity.*provider and model\.modelId/i,
    );
  });

  it("binds same-adapter route trees as portable GenerationModel values", () => {
    const routed = router({
      id: "quality",
      classify: () => "fast" as const,
      routes: { fast: model, default: model },
    });
    const bound = aiSdk(routed);

    expect(bound._tag).toBe("crux.generation-model");
    expect(bound.identity).toEqual({
      kind: "router",
      router: "quality",
      routes: [
        { key: "default", target: "test:scripted-model" },
        { key: "fast", target: "test:scripted-model" },
      ],
    });
    expect(bound.native).toBe(routed);
  });

  it("changes identity when the bound model id changes", () => {
    const identityFor = (modelId: string) => {
      const task = createCruxAi().generate.task(
        prompt({
          input: z.object({ topic: z.string() }),
          prompt: "Summarize.",
        }),
        {
          model: aiSdk({
            provider: "test",
            modelId,
            specificationVersion: "v3",
          } as unknown as LanguageModel),
        },
      );
      return getEvalTaskDescriptorForInternalUse(task).projectIdentity({
        phase: "plan",
        input: { topic: "refunds" },
        overrides: {},
      });
    };

    expect(identityFor("model:v1")).not.toEqual(identityFor("model:v2"));
  });

  it("detects provider-reported model drift before evidence can be written", () => {
    const task = createCruxAi().generate.task(
      prompt({
        input: z.object({ topic: z.string() }),
        prompt: "Summarize.",
      }),
      {
        model: aiSdk({
          provider: "test",
          modelId: "expected-model",
          specificationVersion: "v3",
        } as unknown as LanguageModel),
      },
    );
    const descriptor = getEvalTaskDescriptorForInternalUse(task);
    const planned = descriptor.projectIdentity({
      phase: "plan",
      input: { topic: "refunds" },
      overrides: {},
    });
    const observed = descriptor.projectIdentity({
      phase: "observed",
      input: { topic: "refunds" },
      overrides: {},
      result: { finalStep: { modelId: "drifted-model" } },
    });

    expect(planned).toMatchObject({ reusable: true });
    expect(observed).toMatchObject({ reusable: true });
    expect(observed).not.toEqual(planned);
  });

  it("rejects same-name class models whose hidden provider configuration can differ", () => {
    class ProviderLanguageModel {
      readonly specificationVersion = "v3";
      readonly provider = "test.provider";
      readonly modelId = "stable-model";
      constructor(readonly config: { readonly baseURL: string }) {}
      doGenerate() {
        throw new Error("not executed while planning");
      }
      doStream() {
        throw new Error("not executed while planning");
      }
    }
    const project = (baseURL: string) =>
      getEvalTaskDescriptorForInternalUse(
        createCruxAi().generate.task(
          prompt({
            input: z.object({ topic: z.string() }),
            prompt: "Summarize.",
          }),
          {
            model: new ProviderLanguageModel({
              baseURL,
            }) as unknown as LanguageModel,
          },
        ),
      ).projectIdentity({
        phase: "plan",
        input: { topic: "refunds" },
        overrides: {},
      });

    expect(project("https://one.example.test")).toEqual({
      reusable: false,
      reason: "model_identity_unattested",
    });
    expect(project("https://two.example.test")).toEqual({
      reusable: false,
      reason: "model_identity_unattested",
    });
  });

  it("keeps explicit string model identity reusable", () => {
    const task = createCruxAi().generate.task(
      prompt({
        input: z.object({ topic: z.string() }),
        prompt: "Summarize.",
      }),
      { model: "provider/stable-model" as never },
    );

    expect(
      getEvalTaskDescriptorForInternalUse(task).projectIdentity({
        phase: "plan",
        input: { topic: "refunds" },
        overrides: {},
      }),
    ).toMatchObject({ reusable: true });
  });

  it("projects inherited and explicit judge models through the adapter identity authority", () => {
    const task = createCruxAi().generate.task(
      prompt({
        input: z.object({ topic: z.string() }),
        prompt: "Summarize.",
      }),
      { model: "provider/task-model" as never },
    );
    const descriptor = getEvalTaskDescriptorForInternalUse(task);
    const inherited = descriptor.projectScorerContext?.({
      input: { topic: "refunds" },
      overrides: {},
    });
    const explicit = descriptor.projectScorerContext?.({
      input: { topic: "refunds" },
      overrides: {},
      model: "provider/judge-model",
    });
    const unattested = descriptor.projectScorerContext?.({
      input: { topic: "refunds" },
      overrides: {},
      model: {
        provider: "test",
        modelId: "hidden-gateway",
        specificationVersion: "v3",
      } as unknown as LanguageModel,
    });

    expect(inherited).toMatchObject({
      reusable: true,
      fingerprintMaterial: { model: { modelId: "provider/task-model" } },
    });
    expect(explicit).toMatchObject({
      reusable: true,
      fingerprintMaterial: { model: { modelId: "provider/judge-model" } },
    });
    expect(explicit).not.toEqual(inherited);
    expect(unattested).toEqual({
      reusable: false,
      reason: "model_identity_unattested",
    });
  });

  it("does not treat authored router callback source as runtime identity", () => {
    const routed = router({
      id: "judge-router",
      classify: () => "fast" as const,
      routes: {
        fast: "provider/fast",
        default: "provider/default",
      },
    });
    const task = createCruxAi().generate.task(
      prompt({ input: z.object({ topic: z.string() }), prompt: "Summarize." }),
      { model: "provider/task-model" as never },
    );
    const project =
      getEvalTaskDescriptorForInternalUse(task).projectScorerContext!;

    expect(
      project({ input: { topic: "refunds" }, overrides: {}, model: routed }),
    ).toEqual({
      reusable: false,
      reason: "unresolved_source_dependency",
    });
    expect(
      project({
        input: { topic: "refunds" },
        overrides: {},
        model: routed,
        authoredSourceFingerprint: "eval-source-v1",
      }),
    ).toEqual({
      reusable: false,
      reason: "untracked_external_dependency",
    });
  });

  it("does not trust arbitrary LanguageModel objects with matching metadata", () => {
    const make = () =>
      createCruxAi().generate.task(
        prompt({
          input: z.object({ topic: z.string() }),
          prompt: "Summarize.",
        }),
        {
          model: {
            provider: "test",
            modelId: "scripted-model",
            specificationVersion: "v3",
          } as unknown as LanguageModel,
        },
      );
    const project = () =>
      getEvalTaskDescriptorForInternalUse(make()).projectIdentity({
        phase: "plan",
        input: { topic: "refunds" },
        overrides: {},
      });

    expect(project()).toEqual({
      reusable: false,
      reason: "model_identity_unattested",
    });
    expect(project()).toEqual(project());
  });

  it("fails closed for a captured custom gateway and returns the same observed identity", async () => {
    const scripted = scriptedGateway({ generateText: [{ text: "done" }] });
    const task = createCruxAi({ gateway: scripted.gateway }).generate.task(
      prompt({
        input: z.object({ topic: z.string() }),
        system: "Be concise.",
        prompt: "Summarize the supplied topic.",
      }),
      { model, temperature: 0.2 },
    );
    const descriptor = getEvalTaskDescriptorForInternalUse(task);

    const planned = descriptor.projectIdentity({
      phase: "plan",
      input: { topic: "refunds" },
      call: { temperature: 0.7 },
      overrides: { maxTokens: 32 },
    });

    expect(scripted.calls.generateText).toHaveLength(0);
    expect(planned).toEqual({
      reusable: false,
      reason: "untracked_external_dependency",
    });

    const execution = await executeEvalTaskForInternalUse(
      task,
      { topic: "refunds" },
      { temperature: 0.7 },
      { maxTokens: 32 },
    );

    expect(scripted.calls.generateText).toHaveLength(1);
    expect(execution.observedIdentity).toEqual(planned);
  });

  it("uses tracked task source identity for managed prompt renderers without rendering while projecting", () => {
    let renders = 0;
    let instruction = "concise";
    const task = createCruxAi().generate.task(
      prompt({
        input: z.object({ topic: z.string() }),
        prompt: ({ input }) => {
          renders += 1;
          return `${instruction}: ${input.topic}`;
        },
      }),
      { model: aiSdk(model) },
    );

    const descriptor = getEvalTaskDescriptorForInternalUse(task);
    const first = descriptor.projectIdentity({
      phase: "plan",
      input: { topic: "refunds" },
      overrides: {},
    });
    instruction = "detailed";
    const second = descriptor.projectIdentity({
      phase: "plan",
      input: { topic: "refunds" },
      overrides: {},
    });

    expect(first).toMatchObject({ reusable: true });
    expect(second).toEqual(first);
    expect(renders).toBe(0);
  });

  it("uses tracked task source identity for function-form system and messages", () => {
    let renders = 0;
    const systemTask = createCruxAi().generate.task(
      prompt({
        input: z.object({ topic: z.string() }),
        system: ({ input }) => {
          renders += 1;
          return `System for ${input.topic}`;
        },
        prompt: "Summarize.",
      }),
      { model: aiSdk(model) },
    );
    const messagesTask = createCruxAi().generate.task(
      prompt({
        input: z.object({ topic: z.string() }),
        messages: ({ input }) => {
          renders += 1;
          return [{ role: "user", content: input.topic }];
        },
      }),
      { model: aiSdk(model) },
    );

    const project = (task: typeof systemTask | typeof messagesTask) =>
      getEvalTaskDescriptorForInternalUse(task).projectIdentity({
        phase: "plan",
        input: { topic: "refunds" },
        overrides: {},
      });

    expect(project(systemTask)).toMatchObject({ reusable: true });
    expect(project(messagesTask)).toMatchObject({ reusable: true });
    expect(renders).toBe(0);
  });

  it("captures the exact resolved prompt used by managed execution", async () => {
    const scripted = scriptedGateway({ generateText: [{ text: "done" }] });
    let renders = 0;
    const task = createCruxAi({ gateway: scripted.gateway }).generate.task(
      prompt({
        input: z.object({ topic: z.string() }),
        prompt: ({ input }) => {
          renders += 1;
          return `Summarize ${input.topic}.`;
        },
      }),
      { model: aiSdk(model) },
    );

    const execution = await executeEvalTaskForInternalUse(task, {
      topic: "refunds",
    });

    expect(renders).toBe(2);
    expect(execution.renderedPromptIdentity).toMatchObject({ reusable: true });
  });

  it("re-renders a deterministic managed prompt to the same candidate identity", async () => {
    const scripted = scriptedGateway({ generateText: [{ text: "done" }] });
    const task = createCruxAi({ gateway: scripted.gateway }).generate.task(
      prompt({
        input: z.object({ topic: z.string() }),
        prompt: ({ input }) => `Summarize ${input.topic}.`,
      }),
      { model: aiSdk(model) },
    );
    const descriptor = getEvalTaskDescriptorForInternalUse(task);
    const execution = await executeEvalTaskForInternalUse(task, {
      topic: "refunds",
    });

    await expect(
      descriptor.projectRenderedPromptIdentity?.({
        phase: "plan",
        input: { topic: "refunds" },
        overrides: {},
      }),
    ).resolves.toEqual(execution.renderedPromptIdentity);
  });

  it("re-renders the same resolved Context contributions when no token budget is authored", async () => {
    const scripted = scriptedGateway({ generateText: [{ text: "done" }] });
    const task = createCruxAi({ gateway: scripted.gateway }).generate.task(
      prompt({
        input: z.object({ topic: z.string() }),
        use: [context({ id: "facts", system: "Use verified facts." })],
        prompt: ({ input }) => `Summarize ${input.topic}.`,
      }),
      { model: aiSdk(model) },
    );
    const descriptor = getEvalTaskDescriptorForInternalUse(task);
    const execution = await executeEvalTaskForInternalUse(task, {
      topic: "refunds",
    });

    await expect(
      descriptor.projectRenderedPromptIdentity?.({
        phase: "plan",
        input: { topic: "refunds" },
        overrides: {},
      }),
    ).resolves.toEqual(execution.renderedPromptIdentity);
  });

  it("detects a nondeterministic managed renderer before reusing its output", async () => {
    const scripted = scriptedGateway({ generateText: [{ text: "done" }] });
    let nonce = 0;
    const task = createCruxAi({ gateway: scripted.gateway }).generate.task(
      prompt({
        input: z.object({ topic: z.string() }),
        prompt: ({ input }) => `${input.topic}:${++nonce}`,
      }),
      { model: aiSdk(model) },
    );
    const descriptor = getEvalTaskDescriptorForInternalUse(task);
    const execution = await executeEvalTaskForInternalUse(task, {
      topic: "refunds",
    });
    const candidate = await descriptor.projectRenderedPromptIdentity?.({
      phase: "plan",
      input: { topic: "refunds" },
      overrides: {},
    });

    expect(candidate).toMatchObject({ reusable: true });
    expect(candidate).not.toEqual(execution.renderedPromptIdentity);
  });
});
