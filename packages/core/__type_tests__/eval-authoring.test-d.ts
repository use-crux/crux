/**
 * Type contract for inert Eval authoring.
 *
 * The task is the sole source of Case input and semantic output inference.
 */

import { expectTypeOf } from "vitest";
import { z } from "zod";
import { caseFile, evaluate } from "@use-crux/core/eval";
import type {
  AnyEval,
  CallOf,
  CapsOf,
  CaseOf,
  CaseFile,
  Eval,
  EvalAssertContext,
  EvalCapability,
  EvalCase,
  EvalCaseContext,
  EvalCoverageTargetId,
  EvalGates,
  EvalScorer,
  EvalScorerFactory,
  EvalTask,
  EvalTaskLike,
  InputOf,
  OutputOf,
  VariantOf,
} from "@use-crux/core/eval";
// @ts-expect-error — legacy Quality vocabulary is not part of the Eval surface
import type { Evaluation } from "@use-crux/core/eval";
// @ts-expect-error — only the Eval-prefixed context alias is public here
import type { CaseContext as ForbiddenCaseContext } from "@use-crux/core/eval";
// @ts-expect-error — only the Eval-prefixed assertion alias is public here
import type { AssertContext as ForbiddenAssertContext } from "@use-crux/core/eval";
// @ts-expect-error — only the Eval-prefixed scorer alias is public here
import type { Scorer as ForbiddenScorer } from "@use-crux/core/eval";
// @ts-expect-error — only the Eval-prefixed Gates alias is public here
import type { Gates as ForbiddenGates } from "@use-crux/core/eval";
// @ts-expect-error — Experiment-era containers are intentionally absent
import type { Experiment } from "@use-crux/core/eval";
// @ts-expect-error — file-backed Cases do not introduce a Dataset resource
import type { Dataset } from "@use-crux/core/eval";
// @ts-expect-error — execution targets stay private to coordinators
import type { Target } from "@use-crux/core/eval";
// @ts-expect-error — cassette/replay authoring is intentionally absent
import type { ReplayMode } from "@use-crux/core/eval";
// @ts-expect-error — run records are introduced only in a later phase
import type { EvalRun } from "@use-crux/core/eval";
// @ts-expect-error — the private storage symbol is repository-internal
import { EVAL_INTERNAL } from "@use-crux/core/eval";
// @ts-expect-error — coordinator internals are not public Eval exports
import { getEvalDefinitionForInternalUse } from "@use-crux/core/eval";
import type { AssertContext, CaseContext } from "../src/quality/expect";
import type { Gates } from "../src/quality/gates";
import type { EvaluationCoverageTargetId } from "../src/quality/internal/definition";
import type { Scorer, ScorerFactory } from "../src/quality/scorers";
import type { Capability } from "../src/quality/target";

const classify = async (input: {
  question: string;
}): Promise<{ category: string }> => ({
  category: input.question.length > 20 ? "long" : "short",
});

expectTypeOf<InputOf<typeof classify>>().toEqualTypeOf<{ question: string }>();
expectTypeOf<OutputOf<typeof classify>>().toEqualTypeOf<{ category: string }>();

evaluate({
  task: classify,
  cases: [
    {
      input: {
        // @ts-expect-error — Case input is derived only from the task
        question: 42,
      },
    },
  ],
});

declare const managedTask: EvalTask<
  { question: string },
  { readonly text: string; readonly usage: number },
  string,
  { readonly locale?: string },
  { readonly model?: unknown },
  "modelCalls"
>;
const taskLike: EvalTaskLike = managedTask;
void taskLike;
expectTypeOf<InputOf<typeof managedTask>>().toEqualTypeOf<{
  question: string;
}>();
expectTypeOf<OutputOf<typeof managedTask>>().toEqualTypeOf<string>();
expectTypeOf<CallOf<typeof managedTask>>().toEqualTypeOf<{
  readonly locale?: string;
}>();
expectTypeOf<VariantOf<typeof managedTask>>().toEqualTypeOf<{
  readonly model?: unknown;
}>();
expectTypeOf<CapsOf<typeof managedTask>>().toEqualTypeOf<"modelCalls">();

declare const requiredCallTask: EvalTask<
  { question: string },
  { readonly text: string },
  string,
  { readonly locale: "en" | "nl" },
  { readonly model?: unknown },
  "modelCalls"
>;
// @ts-expect-error — remaining required call keys require the second argument
requiredCallTask({ question: "Refund?" });
requiredCallTask({ question: "Refund?" }, { locale: "en" });
expectTypeOf<OutputOf<typeof requiredCallTask>>().toEqualTypeOf<string>();
expectTypeOf<VariantOf<typeof requiredCallTask>>().toEqualTypeOf<{
  readonly model?: unknown;
}>();
expectTypeOf<CapsOf<typeof requiredCallTask>>().toEqualTypeOf<"modelCalls">();

expectTypeOf<EvalCapability>().toEqualTypeOf<Capability>();
expectTypeOf<EvalCoverageTargetId<"prompt">>().toEqualTypeOf<
  EvaluationCoverageTargetId<"prompt">
>();
expectTypeOf<
  EvalCaseContext<{ q: string }, string, { answer: string }, never>
>().toEqualTypeOf<
  CaseContext<{ q: string }, string, { answer: string }, never>
>();
expectTypeOf<
  EvalAssertContext<{ q: string }, string, { answer: string }, "exact", never>
>().toEqualTypeOf<
  AssertContext<{ q: string }, string, { answer: string }, "exact", never>
>();
expectTypeOf<
  EvalScorer<{ q: string }, string, { answer: string }, "exact">
>().toEqualTypeOf<Scorer<{ q: string }, string, { answer: string }, "exact">>();
expectTypeOf<
  EvalScorerFactory<{ q: string }, string, { answer: string }>
>().toEqualTypeOf<ScorerFactory<{ q: string }, string, { answer: string }>>();
expectTypeOf<EvalGates<"exact">>().toEqualTypeOf<Gates<"exact">>();

const evalValue = evaluate({
  task: classify,
  cases: [{ input: { question: "How do refunds work?" } }],
});
const typedEval: Eval<
  { question: string },
  { category: string },
  string,
  never,
  undefined
> = evalValue;
const inferredEval: typeof evalValue = typedEval;
void inferredEval;
expectTypeOf(evalValue).toMatchTypeOf<AnyEval>();

declare const standaloneCase: CaseOf<
  typeof classify,
  { readonly category: "short" }
>;
expectTypeOf(standaloneCase).toEqualTypeOf<
  EvalCase<
    { question: string },
    { category: string },
    { readonly category: "short" },
    object,
    never,
    string
  >
>();

void getEvalDefinitionForInternalUse;
void EVAL_INTERNAL;

// @ts-expect-error — Eval definitions are inert and have no execution method
evalValue.run();
// @ts-expect-error — Baselines are promoted through the coordinator, not source definitions
evalValue.promote();

evaluate({
  task: classify,
  cases: [{ input: { question: "How do refunds work?" } }],
  // @ts-expect-error — the Eval vocabulary is `cases`, never legacy `data`
  data: [],
});

evaluate({
  task: classify,
  cases: [
    {
      input: { question: "Short question" },
      expected: { label: "short" },
    },
  ],
  expect: (ctx) => {
    expectTypeOf(ctx.expected).toEqualTypeOf<
      { readonly label: "short" } | undefined
    >();
  },
});

const fileCases = caseFile("./support.cases.jsonl", {
  input: z.object({ question: z.string() }),
  expected: z.object({ label: z.string() }),
});
expectTypeOf(fileCases).toEqualTypeOf<
  CaseFile<{ question: string }, { label: string }>
>();
evaluate({ task: classify, cases: [fileCases] });

const incompatibleFile = caseFile("./wrong.cases.jsonl", {
  input: z.object({ topic: z.string() }),
});
evaluate({
  task: classify,
  cases: [
    // @ts-expect-error — case-file input schema must produce the task input
    incompatibleFile,
  ],
});

const classifyLocalized = async (input: {
  question: string;
  locale: "en" | "nl";
}) => input.question;
const missingRequiredInput = caseFile("./missing-locale.cases.jsonl", {
  input: z.object({ question: z.string() }),
});
evaluate({
  task: classifyLocalized,
  cases: [
    // @ts-expect-error — validated file rows must include every task-required input field
    missingRequiredInput,
  ],
});
