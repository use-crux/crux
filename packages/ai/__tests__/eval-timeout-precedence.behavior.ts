import { describe, expect, it } from "vitest";
import { z } from "zod";

import { prompt, TimeoutError, toolBudgetMs } from "@use-crux/core";
import { evalContext } from "@use-crux/core/eval";
import { executeEvalTaskForInternalUse } from "@use-crux/core/eval/internal/task";
import { withEvalContext } from "@use-crux/core/eval/testing";
import type { LanguageModel } from "ai";
import { createGenerateTaskFactory } from "../src/eval-task";

const model = {
  provider: "openai",
  modelId: "timeout-model",
  specificationVersion: "v3",
} as unknown as LanguageModel;

const supportPrompt = prompt({
  input: z.object({ question: z.string() }),
  prompt: ({ input }) => input.question,
});

/** Register marked Eval-ceiling precedence at the managed generate seam. */
export function generateEvalTimeoutPrecedenceBehavior(): void {
  describe("managed Eval timeout precedence", () => {
    it.each([
      {
        name: "task default is tighter",
        defaults: { stepMs: 40 },
        call: undefined,
        overrides: {},
        ceiling: { stepMs: 60 },
        expected: 40,
        expectedTotalMs: 1_000,
      },
      {
        name: "Eval ceiling is tighter",
        defaults: { stepMs: 80 },
        call: undefined,
        overrides: {},
        ceiling: { stepMs: 50 },
        expected: 50,
        expectedTotalMs: 1_000,
      },
      {
        name: "production call is tighter",
        defaults: { stepMs: 100 },
        call: { timeout: { stepMs: 30 } },
        overrides: {},
        ceiling: { stepMs: 50 },
        expected: 30,
        expectedTotalMs: undefined,
      },
      {
        name: "Variant resolves before clamping",
        defaults: { stepMs: 100 },
        call: undefined,
        overrides: { timeout: { stepMs: 70 } },
        ceiling: { stepMs: 50 },
        expected: 50,
        expectedTotalMs: undefined,
      },
      {
        name: "explicit Eval null imposes no ceiling",
        defaults: { stepMs: 40 },
        call: undefined,
        overrides: {},
        ceiling: { stepMs: null },
        expected: 40,
        expectedTotalMs: 1_000,
      },
      {
        name: "equal budgets arm one effective value",
        defaults: { stepMs: 50 },
        call: undefined,
        overrides: {},
        ceiling: { stepMs: 50 },
        expected: 50,
        expectedTotalMs: 1_000,
      },
    ])(
      "$name",
      async ({
        defaults,
        call,
        overrides,
        ceiling,
        expected,
        expectedTotalMs,
      }) => {
        const capture = createGenerateCapture({
          timeout: defaults,
        });
        await withEvalContext(
          { signal: new AbortController().signal, timeout: ceiling },
          () =>
            executeEvalTaskForInternalUse(
              capture.task,
              { question: "Refund?" },
              call,
              overrides,
            ),
        );

        expect(capture.options()[0]?.timeout).toEqual({
          ...(expectedTotalMs === undefined
            ? {}
            : { totalMs: expectedTotalMs }),
          stepMs: expected,
        });
      },
    );

    it("clamps named Tools after normal task Tool resolution", async () => {
      const capture = createGenerateCapture({
        timeout: {
          toolMs: 100,
          tools: { search: 80, disabled: null },
        },
      });

      await withEvalContext(
        {
          signal: new AbortController().signal,
          timeout: {
            toolMs: 70,
            tools: { search: 50, disabled: null },
          },
        },
        () =>
          executeEvalTaskForInternalUse(capture.task, {
            question: "Refund?",
          }),
      );

      const timeout = capture.options()[0]?.timeout as
        | Parameters<typeof toolBudgetMs>[0]
        | undefined;
      expect(toolBudgetMs(timeout, "search")).toBe(50);
      expect(toolBudgetMs(timeout, "other")).toBe(70);
      expect(toolBudgetMs(timeout, "disabled")).toBeUndefined();
    });

    it("distinguishes an intact marked ceiling from an ordinary clone", async () => {
      const intactCapture = createGenerateCapture({
        timeout: { stepMs: 20 },
      });
      const clonedCapture = createGenerateCapture({
        timeout: { stepMs: 20 },
      });
      let marked: ReturnType<typeof evalContext>["timeout"] | undefined;
      await withEvalContext(
        {
          signal: new AbortController().signal,
          timeout: { stepMs: 70 },
        },
        () => {
          marked = evalContext().timeout;
        },
      );

      await intactCapture.task({ question: "intact" }, { timeout: marked! });
      await clonedCapture.task(
        { question: "clone" },
        { timeout: { ...marked! } },
      );

      expect(intactCapture.options()[0]?.timeout).toMatchObject({
        stepMs: 20,
      });
      expect(clonedCapture.options()[0]?.timeout).toMatchObject({
        stepMs: 70,
      });
    });

    it("preserves a canonical nested timeout across the descriptor boundary", async () => {
      const timeout = new TimeoutError({ budget: "step", limitMs: 25 });
      const task = createGenerateTaskFactory(
        async () => {
          throw timeout;
        },
        { executionContractKnown: true },
      )(supportPrompt, { model });

      await expect(
        executeEvalTaskForInternalUse(task, { question: "Refund?" }),
      ).rejects.toBe(timeout);
    });
  });
}

function createGenerateCapture(defaults: {
  readonly timeout: {
    readonly totalMs?: number;
    readonly stepMs?: number;
    readonly toolMs?: number;
    readonly tools?: Readonly<Record<string, number | null>>;
  };
}) {
  const calls: Record<string, unknown>[] = [];
  const factory = createGenerateTaskFactory(
    async (_prompt, options) => {
      calls.push({ ...options });
      return Object.freeze({
        text: "complete",
        content: Object.freeze([]),
        steps: Object.freeze([]),
        toolCalls: Object.freeze([]),
        finishReason: "stop",
        usage: Object.freeze({
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          inputTokenDetails: Object.freeze({}),
          outputTokenDetails: Object.freeze({}),
        }),
        _meta: Object.freeze({
          traceId: "00000000000000000000000000000000",
          spanId: "0000000000000000",
          runId: "run_timeout",
        }),
      }) as never;
    },
    { executionContractKnown: true },
  );
  const task = factory(supportPrompt, {
    model,
    timeout: { totalMs: 1_000, ...defaults.timeout },
  });
  return Object.freeze({
    task,
    options: () => calls,
  });
}
