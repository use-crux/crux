/**
 * Compile-time contract for managed AI Eval tasks.
 *
 * Each row exercises the real package-level authoring API so root and custom
 * instances cannot drift from production inference.
 */

import type { LanguageModel, ModelMessage, ToolSet } from "ai";
import { expectTypeOf } from "vitest";
import { z } from "zod";

import { prompt } from "@use-crux/core";
import { evaluate } from "@use-crux/core/eval";
import type { CallOf, EvalTask, InputOf, OutputOf } from "@use-crux/core/eval";
import { cascade, router, type RouteArgs } from "@use-crux/core/routing";
import { createCruxAi, generate, stableModel } from "../src";

declare const fastModel: LanguageModel;
declare const deepModel: LanguageModel;
declare const callTools: ToolSet;

declare const exactModel: LanguageModel & { readonly deployment: "primary" };
const exactStableModel = stableModel(exactModel);
expectTypeOf(exactStableModel).toEqualTypeOf<typeof exactModel>();

const supportPrompt = prompt({
  input: z.object({ question: z.string() }),
  output: z.object({ answer: z.string() }),
  prompt: ({ input }) => input.question,
});

const tierRouter = router({
  classify: ({ context }: RouteArgs<{ tier: "free" | "pro" }>) =>
    context.tier === "pro" ? "deep" : "fast",
  routes: {
    fast: fastModel,
    deep: deepModel,
    default: fastModel,
  },
});

const routedTask = generate.task(supportPrompt, {
  model: tierRouter,
  temperature: 0.2,
});

// @ts-expect-error — binding model/temperature does not satisfy required routing context
routedTask({ question: "Refund?" });
routedTask({ question: "Refund?" }, { routing: { tier: "pro" } });
routedTask(
  { question: "Refund?" },
  { routing: { tier: "free" }, temperature: 0.7 },
);
expectTypeOf<InputOf<typeof routedTask>>().toEqualTypeOf<{
  question: string;
}>();
expectTypeOf<OutputOf<typeof routedTask>>().toEqualTypeOf<{
  answer: string;
}>();
expectTypeOf<Awaited<ReturnType<typeof routedTask>>["object"]>().toEqualTypeOf<
  { answer: string } | undefined
>();

evaluate({
  task: routedTask,
  cases: [
    // @ts-expect-error — Cases must provide the task's remaining required call context
    { input: { question: "Refund?" } },
  ],
});

const textPrompt = prompt({
  input: z.object({ topic: z.string() }),
  prompt: ({ input }) => input.topic,
});
const textTask = generate.task(textPrompt, { model: fastModel });
expectTypeOf<OutputOf<typeof textTask>>().toEqualTypeOf<string>();
const abortSignal = new AbortController().signal;
void generate(textPrompt, {
  model: fastModel,
  input: { topic: "refunds" },
  signal: abortSignal,
});
void textTask({ topic: "refunds" }, { signal: abortSignal });
generate.task(textPrompt, {
  model: fastModel,
  // @ts-expect-error — one-shot cancellation cannot be bound into reusable defaults
  signal: abortSignal,
});
evaluate({
  task: textTask,
  cases: [
    {
      input: { topic: "refunds" },
      // @ts-expect-error — managed Eval Cases cannot author the engine-owned signal
      call: { signal: abortSignal },
    },
  ],
});

const nativeMessages = [
  {
    role: "user",
    content: [
      { type: "text", text: "Describe this file." },
      {
        type: "file",
        data: "data:application/pdf;base64,JVBERi0x",
        mediaType: "application/pdf",
      },
    ],
  },
] satisfies readonly ModelMessage[];
const multimodalTask = generate.task(textPrompt, {
  model: fastModel,
  messages: nativeMessages,
});
expectTypeOf<InputOf<typeof multimodalTask>>().toEqualTypeOf<{
  topic: string;
}>();
expectTypeOf<OutputOf<typeof multimodalTask>>().toEqualTypeOf<string>();

const unboundModelTask = generate.task(textPrompt, { temperature: 0.2 });
// @ts-expect-error — model remains required when it was not bound by task defaults
unboundModelTask({ topic: "refunds" });
unboundModelTask({ topic: "refunds" }, { model: fastModel });

generate.task(textPrompt, {
  model: fastModel,
  // @ts-expect-error — defaults validate only authored production option keys
  unknownDefault: true,
});

generate.task(textPrompt, {
  // @ts-expect-error — task defaults accept only models supported by the AI adapter
  model: 123,
});

generate.task(textPrompt, { model: fastModel, tools: callTools });

const customTextTask = createCruxAi().generate.task(textPrompt, {
  model: fastModel,
});
expectTypeOf<InputOf<typeof customTextTask>>().toEqualTypeOf<
  InputOf<typeof textTask>
>();
expectTypeOf<OutputOf<typeof customTextTask>>().toEqualTypeOf<
  OutputOf<typeof textTask>
>();
expectTypeOf<CallOf<typeof customTextTask>>().toEqualTypeOf<
  CallOf<typeof textTask>
>();

const conciseTextPrompt = prompt({
  input: z.object({ topic: z.string() }),
  prompt: ({ input }) => `Concise: ${input.topic}`,
});
const widerTextPrompt = prompt({
  input: z.object({
    topic: z.string(),
    locale: z.string().optional(),
  }),
  prompt: ({ input }) => `${input.locale ?? "en"}: ${input.topic}`,
});
const optionalTopicPrompt = prompt({
  input: z.object({ topic: z.string().optional() }),
  prompt: ({ input }) => input.topic ?? "general",
});
const baseBoundCascade = cascade({
  prompt: textPrompt,
  tiers: [{ model: fastModel }],
});
const widerBoundCascade = cascade({
  prompt: optionalTopicPrompt,
  tiers: [{ model: fastModel }],
});

evaluate({
  task: textTask,
  cases: [{ input: { topic: "refunds" } }],
  variants: {
    cheaper: { model: deepModel, temperature: 0.1 },
    concise: { prompt: conciseTextPrompt },
    wider: { prompt: widerTextPrompt },
    paired: { prompt: optionalTopicPrompt, model: widerBoundCascade },
    mismatchedPair: {
      prompt: optionalTopicPrompt,
      // @ts-expect-error — model binding follows the effective Variant prompt
      model: baseBoundCascade,
    },
  },
});

evaluate({
  task: textTask,
  cases: [{ input: { topic: "refunds" } }],
  variants: {
    invalidModel: {
      // @ts-expect-error — Variant models must be supported by the task adapter
      model: 123,
    },
  },
});

declare const incompatibleInputTask: EvalTask<
  { accountId: string },
  { text: string },
  string,
  object,
  object,
  "modelCalls"
>;

evaluate({
  task: textTask,
  cases: [{ input: { topic: "refunds" } }],
  variants: {
    wrongInput: {
      // @ts-expect-error — replacement tasks must accept every base Case input
      task: incompatibleInputTask,
    },
  },
});

evaluate({
  task: textTask,
  cases: [{ input: { topic: "refunds" } }],
  variants: {
    needsRouting: {
      // @ts-expect-error — every Variant must accept the base Case call contract
      model: tierRouter,
    },
  },
});

evaluate({
  task: textTask,
  cases: [{ input: { topic: "refunds" } }],
  variants: {
    unsupported: {
      // @ts-expect-error — Variants accept only the managed task's declared surface
      transportName: "other",
    },
  },
});

evaluate({
  task: textTask,
  cases: [{ input: { topic: "refunds" } }],
  variants: {
    // @ts-expect-error — Current is implicit and cannot be authored as a Variant
    current: {},
  },
});

evaluate({
  task: textTask,
  cases: [{ input: { topic: "refunds" } }],
  variants: {
    // @ts-expect-error — Baseline is historical evidence, not a source Variant
    baseline: {},
  },
});

evaluate({
  task: routedTask,
  cases: [
    {
      input: { question: "Refund?" },
      call: { routing: { tier: "free" } },
    },
  ],
});
