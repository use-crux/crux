import { expect, it } from "vitest";
import { z } from "zod";
import {
  adapter,
  prompt,
  tool,
  type AdapterResponse,
  type AdapterSpec,
  type StepPreparationStats,
} from "../src";

it("projects committed provider facts into the next preparation snapshot", async () => {
  const lookup = tool({
    description: "Look up a value.",
    input: z.object({ key: z.string() }),
    execute: ({ key }) => `value:${key}`,
  });
  const target = prompt({
    id: "prepare-statistics-ledger",
    prompt: "hello",
    tools: { lookup },
  });
  const stats: StepPreparationStats[] = [];
  let calls = 0;
  const response = (): AdapterResponse => {
    calls += 1;
    return {
      text: calls === 1 ? "" : "done",
      toolCalls:
        calls === 1
          ? [{ id: "call-1", name: "lookup", args: { key: "a" } }]
          : undefined,
      usage: {
        inputTokens: 5,
        outputTokens: 3,
        totalTokens: 8,
        inputTokenDetails: {},
        outputTokenDetails: {},
      },
      ...(calls === 1 ? { transportRetries: 2 } : {}),
      finishReason: calls === 1 ? "tool-calls" : "stop",
      responseId: `response-${calls}`,
      actualModelId: "model-1",
    };
  };
  const spec: AdapterSpec<object, object> = {
    providerId: "prepare-statistics-ledger",
    async call() {
      return { raw: {}, extracted: response() };
    },
    async stream() {
      throw new Error("not used");
    },
    appendToolRound: (messages, assistant, results) => [
      ...messages,
      {
        role: "assistant",
        content: assistant.text,
        metadata: { toolCalls: assistant.toolCalls },
      },
      ...results.map((result) => ({
        role: "tool" as const,
        content: result.content,
        metadata: {
          toolCallId: result.toolCallId,
          toolName: result.name,
        },
      })),
    ],
    mapSettings: () => ({}),
  };

  await adapter(spec)({}).generate(target, {
    model: "model-1",
    maxSteps: 2,
    prepareStep: ({ stats: snapshot }) => {
      stats.push(snapshot);
      return undefined;
    },
  });

  expect(stats).toHaveLength(2);
  expect(stats[0]).toMatchObject({
    cursor: 0,
    run: {
      usage: { coverage: { tokens: "none", cost: "none" } },
      modelCalls: {
        started: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
        transportRetries: 0,
      },
    },
  });
  expect(stats[1]).toMatchObject({
    cursor: 4,
    run: {
      usage: {
        inputTokens: 5,
        outputTokens: 3,
        totalTokens: 8,
        coverage: { tokens: "partial", cost: "none" },
      },
      modelCalls: {
        started: 1,
        succeeded: 1,
        failed: 0,
        cancelled: 0,
        transportRetries: 2,
      },
    },
  });
  expect(stats[1]?.root).toEqual(stats[1]?.run);
});
