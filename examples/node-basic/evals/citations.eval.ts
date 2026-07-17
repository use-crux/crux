import { generate } from "@use-crux/ai";
import { prompt } from "@use-crux/core";
import { evaluate } from "@use-crux/core/eval";
import { z } from "zod";
import { supportModel } from "./models";

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

/** The same callable managed task can be used by production code and Evals. */
export const support = generate.task(supportPrompt, {
  model: supportModel,
  temperature: 0.2,
});

export default evaluate({
  id: "examples.support-citations",
  task: support,
  cases: [
    {
      id: "refund-policy",
      input: { question: "How do refunds work?" },
      expected: { source: "policy-refunds" },
    },
  ],
  expect: ({ output, expected, expect }) => {
    expect(output.citations).toContain(expected.source);
  },
});
