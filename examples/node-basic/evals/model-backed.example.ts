/**
 * A second managed task and Variant example.
 *
 * Rename this file to `concise.eval.ts` if you want the CLI to discover it.
 * The invocation uses the provider credentials from the normal environment.
 *
 * @module
 */

import { generate } from "@use-crux/ai";
import { prompt } from "@use-crux/core";
import { evaluate } from "@use-crux/core/eval";
import { z } from "zod";
import { supportModel } from "./models";

const concisePrompt = prompt({
  id: "examples.concise-support",
  input: z.object({ question: z.string() }),
  output: z.object({ answer: z.string() }),
  system: "Answer support questions in one concise sentence.",
  prompt: ({ input }) => input.question,
});

const conciseSupport = generate.task(concisePrompt, {
  model: supportModel,
  temperature: 0.2,
});

export default evaluate({
  id: "examples.concise-support",
  task: conciseSupport,
  cases: [
    {
      id: "refund",
      input: { question: "How do refunds work?" },
    },
  ],
  variants: {
    deterministic: { temperature: 0 },
  },
  expect: ({ output, expect }) => {
    expect(output.answer.length).toBeGreaterThan(0);
  },
});
