import { expect, it } from "vitest";
import { z } from "zod";
import {
  adapter,
  prompt,
  type AdapterResponse,
  type AdapterSpec,
  type ToolResultEntry,
} from "../../src";
import { agent, backgroundable } from "../../src/agent";

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

it("projects a scalar backgroundable child through an object-root provider Tool", async () => {
  let childInput: unknown = Symbol("not-run");
  let parameters: unknown;
  let appendedResult: unknown;
  let calls = 0;
  const child = agent({
    id: "child",
    description: "Child",
    prompt: prompt({
      id: "child-prompt",
      input: z.string(),
      output: z.object({ answer: z.string() }),
      prompt: ({ input }) => {
        childInput = input;
        return "child";
      },
    }),
  });
  const parent = agent({
    id: "parent",
    prompt: prompt({ id: "parent-prompt", prompt: () => "parent" }),
    tools: { child: backgroundable(child) },
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
      calls += 1;
      if (calls === 1) {
        parameters = args.tools[0]?.parameters;
        return {
          raw: {},
          extracted: {
            ...response(""),
            toolCalls: [
              {
                id: "child-call",
                name: "child",
                args: { input: "topic", run_in_background: false },
              },
            ],
          },
        };
      }
      if (args.schema) {
        return { raw: {}, extracted: response('{"answer":"done"}') };
      }
      return { raw: {}, extracted: response("complete") };
    },
    async stream() {
      throw new Error("not used");
    },
    appendToolRound: (messages, _assistant, results: ToolResultEntry[]) => {
      appendedResult = results[0]?.output;
      return messages;
    },
    mapSettings: () => ({}),
  };

  const result = await adapter(spec)({}).parallel({
    id: "backgroundable-tool",
    context: {},
    agents: { parent },
    model: "recording-model",
  });

  expect(parameters).toMatchObject({
    type: "object",
    properties: {
      input: { type: "string" },
      run_in_background: { type: "boolean" },
    },
    required: ["input"],
  });
  expect(childInput).toBe("topic");
  expect(appendedResult).toEqual({ answer: "done" });
  expect(result.results.parent.output).toBe("complete");
});

it("projects a no-input backgroundable child and binds an empty child input", async () => {
  let childInput: unknown = Symbol("not-run");
  let parameters: unknown;
  let appendedResult: unknown;
  let calls = 0;
  const child = agent({
    id: "child",
    description: "Child",
    prompt: prompt({
      id: "child-prompt",
      output: z.object({ answer: z.string() }),
      prompt: ({ input }) => {
        childInput = input;
        return "child";
      },
    }),
  });
  const parent = agent({
    id: "parent",
    prompt: prompt({ id: "parent-prompt", prompt: () => "parent" }),
    tools: { child: backgroundable(child) },
  });
  const spec: AdapterSpec<object, object> = {
    providerId: "recording",
    structuredOutput: { accepts: { id: "recording-structured-output", supportsJsonSchema: true, requiresAllProperties: false, supportsOptionalProperties: true, supportsNullable: true, supportsBooleanSchemas: true, supportsReferences: true, supportsUnions: true, supportsRecursiveSchemas: true, additionalProperties: "must-be-false", unsupportedKeywords: [] } },
    async call(_client, args) {
      calls += 1;
      if (calls === 1) {
        parameters = args.tools[0]?.parameters;
        return { raw: {}, extracted: { ...response(""), toolCalls: [{ id: "child-call", name: "child", args: { run_in_background: false } }] } };
      }
      if (args.schema) return { raw: {}, extracted: response('{"answer":"done"}') };
      return { raw: {}, extracted: response("complete") };
    },
    async stream() { throw new Error("not used"); },
    appendToolRound: (messages, _assistant, results: ToolResultEntry[]) => {
      appendedResult = results[0]?.output;
      return messages;
    },
    mapSettings: () => ({}),
  };

  await adapter(spec)({}).parallel({
    id: "backgroundable-tool", context: {}, agents: { parent }, model: "recording-model",
  });

  expect(parameters).toMatchObject({
    type: "object",
    properties: { run_in_background: { type: "boolean" } },
    additionalProperties: false,
  });
  expect(childInput).toEqual({});
  expect(appendedResult).toEqual({ answer: "done" });
});
