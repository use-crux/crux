/** Compile-time contract for managed streaming Eval tasks. */

import type { LanguageModel } from "ai";
import { expectTypeOf } from "vitest";
import { z } from "zod";

import { prompt } from "@use-crux/core";
import { evaluate } from "@use-crux/core/eval";
import type { CallOf, InputOf, OutputOf } from "@use-crux/core/eval";
import { cascade, router, type RouteArgs } from "@use-crux/core/routing";
import { createCruxAi, stream } from "../src";

declare const fastModel: LanguageModel;
declare const deepModel: LanguageModel;

const textPrompt = prompt({
  input: z.object({ topic: z.string() }),
  prompt: ({ input }) => input.topic,
});
const textTask = stream.task(textPrompt, { model: fastModel });
const abortSignal = new AbortController().signal;
void stream(textPrompt, {
  model: fastModel,
  input: { topic: "refunds" },
  signal: abortSignal,
});
void textTask({ topic: "refunds" }, { signal: abortSignal });
stream.task(textPrompt, {
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
expectTypeOf<InputOf<typeof textTask>>().toEqualTypeOf<{ topic: string }>();
expectTypeOf<OutputOf<typeof textTask>>().toEqualTypeOf<string>();
expectTypeOf<
  Awaited<ReturnType<typeof textTask>>["completion"]
>().toMatchTypeOf<PromiseLike<{ readonly text: string }>>();

const structuredPrompt = prompt({
  input: z.object({ question: z.string() }),
  output: z.object({ answer: z.string() }),
  prompt: ({ input }) => input.question,
});
const structuredTask = createCruxAi().stream.task(structuredPrompt, {
  model: fastModel,
  temperature: 0.2,
});
expectTypeOf<OutputOf<typeof structuredTask>>().toEqualTypeOf<{
  answer: string;
}>();
expectTypeOf<
  Awaited<Awaited<ReturnType<typeof structuredTask>>["completion"]>["object"]
>().toEqualTypeOf<{ answer: string } | undefined>();

const routed = router({
  classify: ({ context }: RouteArgs<{ tier: "fast" | "deep" }>) => context.tier,
  routes: { fast: fastModel, deep: deepModel, default: fastModel },
});
const routedTask = stream.task(textPrompt, { model: routed });
// @ts-expect-error — remaining routing context requires the second argument
routedTask({ topic: "refunds" });
routedTask({ topic: "refunds" }, { routing: { tier: "fast" } });
expectTypeOf<CallOf<typeof routedTask>>().toMatchTypeOf<{
  routing: { tier: "fast" | "deep" };
}>();

const generateOnlyCascade = cascade({
  prompt: textPrompt,
  tiers: [{ model: fastModel }],
});
// @ts-expect-error — cascades require completed generations and cannot stream
stream.task(textPrompt, { model: generateOnlyCascade });
