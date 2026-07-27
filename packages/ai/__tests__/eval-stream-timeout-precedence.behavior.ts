import { describe, expect, it } from "vitest";
import { z } from "zod";

import { prompt, TimeoutError } from "@use-crux/core";
import { executeEvalTaskForInternalUse } from "@use-crux/core/eval/internal/task";
import { withEvalContext } from "@use-crux/core/eval/testing";
import type { LanguageModel } from "ai";
import { createStreamTaskFactory } from "../src/eval-stream-task";

const model = {
  provider: "openai",
  modelId: "timeout-stream-model",
  specificationVersion: "v3",
} as unknown as LanguageModel;

/** Register marked Eval-ceiling precedence at the managed stream seam. */
export function streamEvalTimeoutPrecedenceBehavior(): void {
  describe("managed stream Eval timeout precedence", () => {
    it.each([
      { task: 40, eval: 60, expected: 40 },
      { task: 80, eval: 50, expected: 50 },
      { task: 50, eval: 50, expected: 50 },
      { task: 40, eval: null, expected: 40 },
    ])(
      "clamps task chunk $task against Eval chunk $eval",
      async ({ task: taskMs, eval: evalMs, expected }) => {
        const capture = createStreamCapture(taskMs);
        await withEvalContext(
          {
            signal: new AbortController().signal,
            timeout: { chunkMs: evalMs },
          },
          () =>
            executeEvalTaskForInternalUse(capture.task, {
              topic: "refunds",
            }),
        );

        expect(capture.options()[0]?.timeout).toMatchObject({
          chunkMs: expected,
        });
      },
    );

    it("preserves canonical Tool timeout metadata at the descriptor boundary", async () => {
      const timeout = new TimeoutError({
        budget: "tool",
        limitMs: 30,
        toolName: "search",
      });
      const task = createStreamTaskFactory(
        async () => {
          throw timeout;
        },
        async () => undefined,
        { executionContractKnown: true },
      )(
        prompt({
          input: z.object({ topic: z.string() }),
          prompt: ({ input }) => input.topic,
        }),
        { model },
      );

      await expect(
        executeEvalTaskForInternalUse(task, { topic: "refunds" }),
      ).rejects.toBe(timeout);
      expect(timeout).toMatchObject({
        budget: "tool",
        limitMs: 30,
        toolName: "search",
      });
    });
  });
}

function createStreamCapture(chunkMs: number) {
  const calls: Record<string, unknown>[] = [];
  const factory = createStreamTaskFactory(
    async (_prompt, options) => {
      calls.push({ ...options });
      return {
        textStream: (async function* () {
          yield "complete";
        })(),
        completion: Promise.resolve({
          text: "complete",
          content: [],
          finalStep: { toolCalls: [] },
          steps: [],
          toolCalls: [],
          finishReason: "stop",
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            inputTokenDetails: {},
            outputTokenDetails: {},
          },
          _meta: {
            traceId: "00000000000000000000000000000000",
            spanId: "0000000000000000",
            runId: "run_timeout_stream",
          },
        }),
      } as never;
    },
    async () => undefined,
    { executionContractKnown: true },
  );
  const task = factory(
    prompt({
      input: z.object({ topic: z.string() }),
      prompt: ({ input }) => input.topic,
    }),
    { model, timeout: { chunkMs } },
  );
  return Object.freeze({
    task,
    options: () => calls,
  });
}
