import { expect, it } from "vitest";
import { z } from "zod";
import {
  adapter,
  context,
  prompt,
  tool,
  type AdapterResponse,
  type AdapterSpec,
  type StepContext,
} from "../src";

it("keeps amendments boundary-local and reports committed prior-step facts", async () => {
  const base = context({ id: "loop-base", system: "BASE" });
  const lookup = tool({
    description: "Look up a value.",
    input: z.object({ key: z.string() }),
    execute: ({ key }) => `value:${key}`,
  });
  const target = prompt({
    id: "prepare-step-loop",
    use: [base],
    prompt: "hello",
    tools: { lookup },
  });
  const systems: Array<string | undefined> = [];
  const contexts: StepContext[] = [];
  let calls = 0;
  const usage = {
    inputTokens: 5,
    outputTokens: 3,
    totalTokens: 8,
    inputTokenDetails: {},
    outputTokenDetails: {},
  };
  const response = (toolRound: boolean): AdapterResponse => ({
    text: toolRound ? "" : "done",
    toolCalls: toolRound
      ? [{ id: "call-1", name: "lookup", args: { key: "a" } }]
      : undefined,
    usage,
    finishReason: toolRound ? "tool-calls" : "stop",
    responseId: `response-${calls}`,
    actualModelId: "model-1",
  });
  const spec: AdapterSpec<object, object> = {
    providerId: "prepare-loop",
    async call(_client, args) {
      systems.push(args.system);
      calls += 1;
      return { raw: {}, extracted: response(calls === 1) };
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
    prepareStep(step) {
      contexts.push(step);
      return step.index === 0
        ? { use: { remove: [{ id: "loop-base" }] } }
        : undefined;
    },
  });

  expect(systems).toEqual([undefined, "BASE"]);
  expect(contexts).toHaveLength(2);
  expect(contexts[1]).toMatchObject({
    index: 1,
    reason: "tool-result",
    previousReceipt: { model: "model-1" },
    stats: {
      run: {
        usage: {
          inputTokens: 5,
          outputTokens: 3,
          totalTokens: 8,
          coverage: { tokens: "complete", cost: "none" },
        },
        modelCalls: { started: 1, succeeded: 1 },
      },
    },
    toolHistory: [
      {
        callId: "call-1",
        name: "lookup",
        result: "value:a",
      },
    ],
  });
});
