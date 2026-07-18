import { expectTypeOf } from "vitest";
import { evaluate } from "@use-crux/core/eval";
import type {
  EvalAssertContext,
  EvalCaseContext,
  EvalTask,
} from "@use-crux/core/eval";
import type { StreamCompletion } from "../src/adapter";

declare const task: EvalTask<
  { readonly question: string },
  { readonly text: string },
  string,
  object,
  object,
  "steps"
>;
type ManagedResponse = StreamCompletion<string>;

declare const ordinary: EvalCaseContext<
  { readonly question: string },
  string,
  string,
  "steps"
>;
ordinary.expect.cost.toBeUnderUsd(1);
ordinary.expect.errors.toHaveNone();
ordinary.step("draft").status;
// @ts-expect-error — standalone/opaque contexts do not expose managed response
ordinary.response;

declare const managedOrdinary: EvalCaseContext<
  { readonly question: string },
  string,
  string,
  "steps",
  ManagedResponse
>;
expectTypeOf(managedOrdinary.response.text).toEqualTypeOf<string>();
// @ts-expect-error — timing evidence is available only in declared fresh callbacks
ordinary.expect.latency.toBeUnderMs(1_000);
// @ts-expect-error — timing evidence is available only in declared fresh callbacks
ordinary.meta.durationMs;
// @ts-expect-error — timing evidence is available only in declared fresh callbacks
ordinary.step("draft").durationMs;

declare const ordinaryAfterScores: EvalAssertContext<
  { readonly question: string },
  string,
  string,
  "quality",
  "steps"
>;
ordinaryAfterScores.score.quality;
// @ts-expect-error — post-score timing matchers require a fresh descriptor
ordinaryAfterScores.expect.latency.toBeUnderMs(1_000);
// @ts-expect-error — post-score timing evidence also requires a fresh descriptor
ordinaryAfterScores.meta.durationMs;
// @ts-expect-error — post-score step timing also requires a fresh descriptor
ordinaryAfterScores.step("draft").durationMs;

evaluate({
  task,
  cases: [
    {
      input: { question: "Refund?" },
      expect: {
        fresh: true,
        check: (ctx) => {
          expectTypeOf(ctx.response.text).toEqualTypeOf<string>();
          ctx.expect.latency.toBeUnderMs(1_000);
          expectTypeOf(ctx.meta.durationMs).toEqualTypeOf<number>();
          expectTypeOf(ctx.step("draft").durationMs).toEqualTypeOf<number>();
          expectTypeOf(ctx.step("draft").durationMs).toEqualTypeOf<number>();
        },
      },
      afterScores: {
        fresh: true,
        check: (ctx) => {
          expectTypeOf(ctx.response.text).toEqualTypeOf<string>();
          ctx.expect.latency.toBeUnderMs(1_000);
          expectTypeOf(ctx.meta.durationMs).toEqualTypeOf<number>();
        },
      },
    },
  ],
  expect: {
    fresh: true,
    check: (ctx) => {
      expectTypeOf(ctx.response.text).toEqualTypeOf<string>();
      ctx.expect.latency.toBeUnderMs(1_000);
      expectTypeOf(ctx.meta.durationMs).toEqualTypeOf<number>();
      expectTypeOf(ctx.step("draft").durationMs).toEqualTypeOf<number>();
      expectTypeOf(ctx.step("draft").durationMs).toEqualTypeOf<number>();
    },
  },
  afterScores: {
    fresh: true,
    check: (ctx) => {
      expectTypeOf(ctx.response.text).toEqualTypeOf<string>();
      ctx.expect.latency.toBeUnderMs(1_000);
      expectTypeOf(ctx.meta.durationMs).toEqualTypeOf<number>();
    },
  },
});

evaluate({
  task: async (input: { readonly question: string }) => input.question,
  cases: [{ input: { question: "Refund?" } }],
  expect: (ctx) => {
    // @ts-expect-error — opaque functions have no normalized managed response
    ctx.response;
  },
});

evaluate({
  task,
  cases: [{ input: { question: "Refund?" } }],
  gates: {
    // @ts-expect-error — a latency Gate must declare meanMs or p95Ms
    latency: {},
  },
});
