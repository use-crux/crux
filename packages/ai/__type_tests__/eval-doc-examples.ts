/** Compile-checked public snippets used by the Eval and feedback guides. */

import type { LanguageModel } from "ai";
import { z } from "zod";
import { generate, stableModel } from "@use-crux/ai";
import { feedback as messageFeedback } from "@use-crux/ai/feedback";
import { prompt } from "@use-crux/core";
import { caseFile, evaluate } from "@use-crux/core/eval";
import { feedback as runFeedback } from "@use-crux/core/feedback";
import type { CruxRunId } from "@use-crux/core/observability";

declare const supportModel: LanguageModel;
declare const cheaperModel: LanguageModel;
declare const runId: CruxRunId;
declare const message: { readonly metadata: unknown };

const SupportInputSchema = z.object({ question: z.string() });
const SupportExpectedSchema = z.object({ phrase: z.string() });
const supportPrompt = prompt({
  id: "support",
  input: SupportInputSchema,
  output: z.object({ answer: z.string() }),
  system: "Answer support questions accurately and concisely.",
  prompt: ({ input }) => input.question,
});
const support = generate.task(supportPrompt, {
  model: stableModel(supportModel),
  temperature: 0.2,
});

evaluate({
  id: "support",
  task: support,
  cases: [
    {
      id: "refund",
      input: { question: "Can I get a refund?" },
      expected: { phrase: "refund" },
    },
    caseFile("./fixtures/refunds.jsonl", {
      input: SupportInputSchema,
      expected: SupportExpectedSchema,
    }),
  ],
  variants: {
    cheaper: { model: stableModel(cheaperModel), temperature: 0 },
  },
  expect: ({ output, expected, expect }) => {
    if (expected) expect(output.answer).toContain(expected.phrase);
  },
  gates: {
    latency: { p95Ms: 2_000 },
  },
});

void runFeedback(runId, { rating: "down", comment: "Incorrect refund window" });
void messageFeedback(message, "down");
