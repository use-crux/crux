/** Compile-time compatibility matrix for managed Eval Variants. */

import type { LanguageModel } from "ai";
import { z } from "zod";

import { prompt } from "@use-crux/core";
import { evaluate } from "@use-crux/core/eval";
import type { EvalTask } from "@use-crux/core/eval";
import { generate } from "../src";

declare const model: LanguageModel;

const basePrompt = prompt({
  input: z.object({ topic: z.string() }),
  prompt: ({ input }) => input.topic,
});
const task = generate.task(basePrompt, { model });

const wrongInputPrompt = prompt({
  input: z.object({ accountId: z.string() }),
  prompt: ({ input }) => input.accountId,
});
const wrongOutputPrompt = prompt({
  input: z.object({ topic: z.string() }),
  output: z.object({ answer: z.string() }),
  prompt: ({ input }) => input.topic,
});

evaluate({
  task,
  cases: [{ input: { topic: "refunds" } }],
  variants: {
    wrongInput: {
      // @ts-expect-error — replacement prompt must accept every base Case input
      prompt: wrongInputPrompt,
    },
    wrongOutput: {
      // @ts-expect-error — replacement prompt must preserve semantic Eval output
      prompt: wrongOutputPrompt,
    },
  },
});

declare const compatibleTask: EvalTask<
  { topic: string; locale?: string },
  { text: string },
  "fixed",
  object,
  object,
  "modelCalls"
>;
declare const wrongOutputTask: EvalTask<
  { topic: string },
  { object: number },
  number,
  object,
  object,
  "modelCalls"
>;
declare const wrongCallTask: EvalTask<
  { topic: string },
  { text: string },
  string,
  { tenantId: string },
  object,
  "modelCalls"
>;

evaluate({
  task,
  cases: [{ input: { topic: "refunds" } }],
  variants: {
    compatible: { task: compatibleTask },
    wrongOutput: {
      // @ts-expect-error — replacement task output must be covariant
      task: wrongOutputTask,
    },
    wrongCall: {
      // @ts-expect-error — replacement task may not require new Case call fields
      task: wrongCallTask,
    },
  },
});

evaluate({
  // @ts-expect-error — evaluate() accepts managed tasks or opaque functions, not a bare prompt
  task: basePrompt,
  cases: [],
});
