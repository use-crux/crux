import { openai } from "@ai-sdk/openai";
import { generate, stableModel } from "@use-crux/ai";
import { prompt } from "@use-crux/core";
import { z } from "zod";

const supportModel = stableModel(openai("gpt-4o-mini"));

const supportPrompt = prompt({
  id: "examples.support-citations",
  input: z.object({ question: z.string() }),
  output: z.object({
    answer: z.string(),
    citations: z.array(z.string()),
  }),
  system: "Answer support questions and cite the relevant policy id.",
  prompt: ({ input }) => input.question,
});

/** Callable production task imported unchanged by the Eval. */
export const support = generate.task(supportPrompt, {
  model: supportModel,
  temperature: 0.2,
});

const concisePrompt = prompt({
  id: "examples.concise-support",
  input: z.object({ question: z.string() }),
  output: z.object({ answer: z.string() }),
  system: "Answer support questions in one concise sentence.",
  prompt: ({ input }) => input.question,
});

/** A second production task used by the optional Variant example. */
export const conciseSupport = generate.task(concisePrompt, {
  model: supportModel,
  temperature: 0.2,
});
