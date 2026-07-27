/** Compile-time inference contract for Cases, scorers, Gates, and Eval names. */

import { expectTypeOf } from "vitest";

import { evaluate } from "@use-crux/core/eval";
import type { CaseOf, Eval, EvalTask } from "@use-crux/core/eval";
import { scorers } from "../src/eval/internal/scorers/types";

declare const answerTask: EvalTask<
  { question: string },
  { text: string; object?: { answer: string } },
  { answer: string },
  {},
  { temperature?: number },
  "modelCalls"
>;

declare const cancellableRoutedTask: EvalTask<
  { question: string },
  { text: string },
  string,
  { tenantId: string; locale?: string; signal?: AbortSignal },
  object,
  "modelCalls"
>;
expectTypeOf<CaseOf<typeof cancellableRoutedTask>["call"]>().toEqualTypeOf<{
  tenantId: string;
  locale?: string;
}>();

evaluate({
  task: cancellableRoutedTask,
  timeout: { totalMs: null, toolMs: 1_000 },
  cases: [
    {
      input: { question: "Refund?" },
      call: { tenantId: "acme", locale: "nl" },
      timeout: { tools: { search: null } },
    },
  ],
});
expectTypeOf<CaseOf<typeof cancellableRoutedTask>["call"]>().toEqualTypeOf<{
  tenantId: string;
  locale?: string;
}>();

const scoredEval = evaluate({
  task: answerTask,
  cases: [
    {
      id: "refund",
      input: { question: "Can I get a refund?" },
      expected: { answer: "yes" },
    },
  ],
  expect: (ctx) => {
    expectTypeOf(ctx.expected).toEqualTypeOf<
      { readonly answer: "yes" } | undefined
    >();
  },
  scorers: [scorers.exact({ name: "helpful" })],
  gates: {
    scores: {
      helpful: { min: 0.8 },
      pass: { min: 1 },
      // @ts-expect-error — Gate keys come from scorer literals plus `pass`
      typo: { min: 0.5 },
    },
  },
  variants: {
    concise: { temperature: 0.1 },
  },
});

const expectedEval: Eval<
  { question: string },
  { answer: string },
  "helpful" | "pass",
  "concise",
  undefined
> = scoredEval;
const inferredEval: typeof scoredEval = expectedEval;
void inferredEval;
expectTypeOf(scoredEval.id).toEqualTypeOf<undefined>();

const unscoredEval = evaluate({
  task: answerTask,
  cases: [{ input: { question: "Any answer?" } }],
  gates: {
    scores: {
      pass: { min: 1 },
      // @ts-expect-error — without authored scorers, only the `pass` Gate exists
      unknown: { min: 0.5 },
    },
  },
});
const expectedUnscoredEval: Eval<
  { question: string },
  { answer: string },
  "pass",
  never,
  undefined
> = unscoredEval;
void expectedUnscoredEval;
