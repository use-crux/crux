import { expect, it } from "vitest";
import { z } from "zod";
import {
  adapter,
  prompt,
  type AdapterResponse,
  type AdapterSpec,
  type ToolResultEntry,
} from "../../src";
import { agent } from "../../src/agent";

function response(text: string): AdapterResponse {
  return {
    text,
    toolCalls: undefined,
    usage: undefined,
    finishReason: "stop",
    responseId: undefined,
    actualModelId: "recording-model",
  };
}

async function runWrappedChild(
  inputSchema: z.ZodType,
  toolArgs: unknown,
  contentMode: "prompt" | "messages" = "prompt",
) {
  let receivedInput: unknown = Symbol("not-run");
  let childProviderCalls = 0;
  let parameters: unknown;
  let providerCalls = 0;
  const child = agent({
    id: "wrapped-child",
    description: "Accept one wrapped input",
    prompt: prompt({
      id: "wrapped-child-prompt",
      input: inputSchema,
      output: z.object({ value: z.string() }),
      ...(contentMode === "prompt"
        ? {
            prompt: ({ input }) => {
              receivedInput = input;
              return "child";
            },
          }
        : {
            messages: ({ input }) => {
              receivedInput = input;
              return [{ role: "user", content: "child" }];
            },
          }),
    }),
  });
  const parent = agent({
    id: "wrapped-parent",
    prompt: prompt({ id: "wrapped-parent-prompt", prompt: () => "parent" }),
    tools: { child },
  });
  const spec: AdapterSpec<object, object> = {
    providerId: "recording",
    structuredOutput: {
      accepts: {
        id: "recording-structured-output",
        supportsJsonSchema: true,
        requiresAllProperties: false,
        supportsOptionalProperties: true,
        supportsNullable: true,
        supportsBooleanSchemas: true,
        supportsReferences: true,
        supportsUnions: true,
        supportsRecursiveSchemas: true,
        additionalProperties: "must-be-false",
        unsupportedKeywords: [],
      },
    },
    async call(_client, args) {
      providerCalls += 1;
      if (providerCalls === 1) {
        parameters = args.tools[0]?.parameters;
        return {
          raw: {},
          extracted: {
            ...response(""),
            toolCalls: [{ id: "wrapped-call", name: "child", args: toolArgs }],
          },
        };
      }
      if (args.schema) {
        childProviderCalls += 1;
        return { raw: {}, extracted: response('{"value":"child"}') };
      }
      return { raw: {}, extracted: response("done") };
    },
    async stream() {
      throw new Error("not used");
    },
    appendToolRound: (messages, _assistant, _results: ToolResultEntry[]) => messages,
    mapSettings: () => ({}),
  };
  const result = await adapter(spec)({}).parallel({
    id: "wrapped-foreground-tool",
    context: {},
    agents: { parent },
    model: "recording-model",
  });
  return { childProviderCalls, parameters, receivedInput, result };
}

it("wraps a scalar child input and unwraps it once before Prompt validation", async () => {
  const run = await runWrappedChild(z.string(), { input: "topic" });

  expect(run.parameters).toMatchObject({
    type: "object",
    properties: { input: { type: "string" } },
    required: ["input"],
  });
  expect(run.receivedInput).toBe("topic");
  expect(run.childProviderCalls).toBe(1);
  expect(run.result.results.parent.output).toBe("done");
});

it("passes a scalar child input to messages callbacks", async () => {
  const run = await runWrappedChild(z.string(), { input: "topic" }, "messages");

  expect(run.receivedInput).toBe("topic");
  expect(run.childProviderCalls).toBe(1);
});

it("wraps a mixed object-or-scalar child input", async () => {
  const run = await runWrappedChild(
    z.union([z.object({ topic: z.string() }), z.string()]),
    { input: { topic: "work" } },
  );

  expect(run.parameters).toMatchObject({
    type: "object",
    properties: { input: { anyOf: expect.any(Array) } },
  });
  expect(run.receivedInput).toEqual({ topic: "work" });
  expect(run.childProviderCalls).toBe(1);
});

it("rejects invalid wrapper arguments before a child provider call", async () => {
  const run = await runWrappedChild(z.string(), { input: 42 });

  expect(run.childProviderCalls).toBe(0);
  expect(run.result.results.parent.output).toBe("done");
});
