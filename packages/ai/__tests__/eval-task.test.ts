import type { LanguageModel } from "ai";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { prompt } from "@use-crux/core";
import { ValidationExhaustedError } from "@use-crux/core";
import { CruxAdapterError, cruxProviderError } from "@use-crux/core/adapter";
import {
  executeEvalTaskForInternalUse,
  getEvalTaskDescriptorForInternalUse,
} from "@use-crux/core/eval/internal/task";
import type { CallOf, CapsOf, InputOf, OutputOf } from "@use-crux/core/eval";
// @ts-expect-error AIGenerate is an implementation detail, not a named export.
import type { AIGenerate } from "@use-crux/ai";
import { createCruxAi, generate } from "../src";
import { objectGenerationError, scriptedGateway } from "./scripted-gateway";

function model(modelId = "gpt-4o"): LanguageModel {
  return {
    provider: "openai",
    modelId,
    specificationVersion: "v3",
  } as unknown as LanguageModel;
}

describe("generate.task()", () => {
  it("shares one generation path between rich production and semantic Eval execution", async () => {
    const first = { answer: "Production" };
    const second = { answer: "Eval" };
    const scripted = scriptedGateway({
      generateObject: [{ object: first }, { object: second }],
    });
    const ai = createCruxAi({ gateway: scripted.gateway });
    const supportPrompt = prompt({
      id: "support",
      input: z.object({ question: z.string() }),
      output: z.object({ answer: z.string() }),
      system: "Answer support questions.",
      prompt: ({ input }) => input.question,
    });
    const task = ai.generate.task(supportPrompt, {
      model: model(),
      temperature: 0.2,
      maxTokens: 64,
    });

    const production = await task({ question: "Refund?" });
    const evaluation = await executeEvalTaskForInternalUse(task, {
      question: "Shipping?",
    });

    expect(production.object).toEqual(first);
    expect(production.raw).toMatchObject({ object: first });
    expect(evaluation.output).toEqual(second);
    expect(evaluation.response).toMatchObject({ object: second });
    expect(evaluation.response).not.toHaveProperty("raw");
    expect(evaluation.response).not.toHaveProperty("_meta");
    expect(scripted.calls.generateObject).toHaveLength(2);
    expect(scripted.calls.generateObject).toEqual([
      expect.objectContaining({
        model: expect.objectContaining({ modelId: "gpt-4o" }),
        prompt: "Refund?",
        temperature: 0.2,
        maxOutputTokens: 64,
      }),
      expect.objectContaining({
        model: expect.objectContaining({ modelId: "gpt-4o" }),
        prompt: "Shipping?",
        temperature: 0.2,
        maxOutputTokens: 64,
      }),
    ]);
    expect(getEvalTaskDescriptorForInternalUse(task)).toMatchObject({
      operation: "generate",
      adapterId: "ai-sdk",
      promptId: "support",
      capabilities: ["modelCalls", "citations", "safety", "decisionReport"],
    });
    expect(Object.isFrozen(task)).toBe(true);

    expectTypeOf(production.object).toEqualTypeOf<
      { answer: string } | undefined
    >();
    expectTypeOf(evaluation.output).toEqualTypeOf<{ answer: string }>();
    expectTypeOf<InputOf<typeof task>>().toEqualTypeOf<{
      question: string;
    }>();
    expectTypeOf<OutputOf<typeof task>>().toEqualTypeOf<{ answer: string }>();
    expectTypeOf<CallOf<typeof task>>().toMatchTypeOf<{
      model?: LanguageModel;
      temperature?: number;
    }>();
    expectTypeOf<CapsOf<typeof task>>().toEqualTypeOf<
      "modelCalls" | "citations" | "safety" | "decisionReport"
    >();
    if (false) {
      // @ts-expect-error Task input is positional and cannot be overridden.
      void task({ question: "x" }, { input: { question: "other" } });
    }
  });

  it("supports unnamed structured prompts on custom and default generate callables", () => {
    const scripted = scriptedGateway();
    const ai = createCruxAi({ gateway: scripted.gateway });
    const unnamed = prompt({
      input: z.object({ question: z.string() }),
      output: z.object({ answer: z.string() }),
      prompt: ({ input }) => input.question,
    });

    const task = ai.generate.task(unnamed, { model: model() });

    expect(ai.generate).toBe(ai.generate);
    expect(ai.generate.task).toBeTypeOf("function");
    expect(generate.task).toBeTypeOf("function");
    expect(getEvalTaskDescriptorForInternalUse(task)).not.toHaveProperty(
      "promptId",
    );
  });

  it("merges per-call overrides over bound defaults without accepting call input", async () => {
    const scripted = scriptedGateway({
      generateObject: [{ object: { answer: "Done" } }],
    });
    const ai = createCruxAi({ gateway: scripted.gateway });
    const supportPrompt = prompt({
      input: z.object({ question: z.string() }),
      output: z.object({ answer: z.string() }),
      prompt: ({ input }) => input.question,
    });
    const task = ai.generate.task(supportPrompt, {
      model: model("bound"),
      temperature: 0.2,
    });

    await task(
      { question: "Override?" },
      { model: model("override"), temperature: 0.7 },
    );

    expect(scripted.calls.generateObject).toHaveLength(1);
    expect(scripted.calls.generateObject[0]).toMatchObject({
      model: { modelId: "override" },
      prompt: "Override?",
      temperature: 0.7,
    });
  });

  it("snapshots bound defaults without cloning nested provider values", async () => {
    const scripted = scriptedGateway({
      generateObject: [
        { object: { answer: "Production" } },
        { object: { answer: "Eval" } },
      ],
    });
    const ai = createCruxAi({ gateway: scripted.gateway });
    const boundModel = model("bound");
    const defaults = { model: boundModel, temperature: 0.2 };
    const task = ai.generate.task(
      prompt({
        input: z.object({ question: z.string() }),
        output: z.object({ answer: z.string() }),
        prompt: ({ input }) => input.question,
      }),
      defaults,
    );
    defaults.model = model("mutated");
    defaults.temperature = 0.9;
    Object.assign(defaults, { maxTokens: 1 });

    await task({ question: "Production?" });
    await executeEvalTaskForInternalUse(task, { question: "Eval?" });

    const descriptor = getEvalTaskDescriptorForInternalUse(task);
    expect(descriptor.defaults).toEqual({
      model: boundModel,
      temperature: 0.2,
    });
    expect(descriptor.defaults).toHaveProperty("model", boundModel);
    expect(descriptor.overrideKeys).toEqual(["model", "temperature"]);
    expect(descriptor.defaults).not.toBe(defaults);
    expect(Object.isFrozen(descriptor.defaults)).toBe(true);
    expect(Object.isFrozen(boundModel)).toBe(false);
    expect(scripted.calls.generateObject).toHaveLength(2);
    for (const call of scripted.calls.generateObject) {
      expect(call).toMatchObject({
        model: { modelId: "bound" },
        temperature: 0.2,
      });
      expect(call).not.toHaveProperty("maxOutputTokens");
    }
  });

  it("raises the precise protocol error when structured output is absent", async () => {
    const scripted = scriptedGateway({ generateObject: [{ text: "{}" }] });
    const ai = createCruxAi({ gateway: scripted.gateway });
    const supportPrompt = prompt({
      id: "missing-object",
      input: z.object({ question: z.string() }),
      output: z.object({ answer: z.string() }),
      prompt: ({ input }) => input.question,
    });
    const task = ai.generate.task(supportPrompt, { model: model() });

    const execution = executeEvalTaskForInternalUse(task, {
      question: "Refund?",
    });

    await expect(execution).rejects.toMatchObject({
      name: "EvalTaskExecutionError",
      code: "structured_output_missing",
      operation: "generate",
      adapterId: "ai-sdk",
      promptId: "missing-object",
    });
    await expect(execution).rejects.toThrowError(
      /generate.*prompt "missing-object".*validated object.*validation failure/i,
    );
    expect(scripted.calls.generateObject).toHaveLength(1);
  });

  it.each(["provider-error", "aborted", "timeout"] as const)(
    "passes an existing %s adapter error through by identity",
    async (kind) => {
      const error = new CruxAdapterError(
        cruxProviderError({
          kind,
          code: `test.${kind}`,
          retryable: kind !== "aborted",
        }),
      );
      const scripted = scriptedGateway({ generateObject: [error] });
      const ai = createCruxAi({ gateway: scripted.gateway });
      const task = ai.generate.task(
        prompt({
          input: z.object({ value: z.string() }),
          output: z.object({ result: z.string() }),
          prompt: ({ input }) => input.value,
        }),
        { model: model() },
      );

      await expect(
        executeEvalTaskForInternalUse(task, { value: "go" }),
      ).rejects.toBe(error);
    },
  );

  it("passes ValidationExhaustedError through without an Eval wrapper", async () => {
    const scripted = scriptedGateway({
      generateObject: [
        objectGenerationError("bad"),
        objectGenerationError("still bad"),
      ],
    });
    const ai = createCruxAi({ gateway: scripted.gateway });
    const task = ai.generate.task(
      prompt({
        id: "invalid",
        input: z.object({ value: z.string() }),
        output: z.object({ result: z.string() }),
        prompt: ({ input }) => input.value,
      }),
      { model: model(), validationRetry: { maxRetries: 1 } },
    );

    const execution = executeEvalTaskForInternalUse(task, { value: "go" });

    await expect(execution).rejects.toBeInstanceOf(ValidationExhaustedError);
    await expect(execution).rejects.not.toMatchObject({
      name: "EvalTaskExecutionError",
    });
    expect(scripted.calls.generateObject).toHaveLength(2);
  });
});
