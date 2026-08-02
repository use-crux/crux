import { expect, it, vi } from "vitest";
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

it("returns a safe Work reference while a backgroundable child is still running", async () => {
  let finishChild!: () => void;
  const childGate = new Promise<void>((resolve) => {
    finishChild = resolve;
  });
  let childFinished = false;
  let childInput: unknown;
  let toolResult: unknown;

  const child = agent({
    id: "research-agent-identity",
    description: "Research one topic",
    prompt: prompt({
      id: "background-child-prompt",
      input: z.object({ topic: z.string() }),
      output: z.object({ secret: z.string() }),
      prompt: ({ input }) => {
        childInput = input;
        return input.topic;
      },
    }),
  });
  const parent = agent({
    id: "parent-agent",
    prompt: prompt({ id: "background-parent-prompt", prompt: () => "parent" }),
    tools: { research: backgroundable(child) },
  });

  let parentCalls = 0;
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
      if (args.schema) {
        await childGate;
        childFinished = true;
        return { raw: {}, extracted: response('{"secret":"child output"}') };
      }

      parentCalls += 1;
      if (parentCalls === 1) {
        expect(args.tools[0]).toMatchObject({
          name: "research",
          parameters: {
            type: "object",
            properties: {
              topic: { type: "string" },
              run_in_background: { type: "boolean" },
            },
            required: ["topic"],
          },
        });
        return {
          raw: {},
          extracted: {
            ...response(""),
            toolCalls: [{
              id: "background-call",
              name: "research",
              args: { topic: "work", run_in_background: true },
            }],
          },
        };
      }
      return { raw: {}, extracted: response("parent finished") };
    },
    async stream() {
      throw new Error("not used");
    },
    appendToolRound(messages, _assistant, results: ToolResultEntry[]) {
      toolResult = results[0]?.output;
      return messages;
    },
    mapSettings: () => ({}),
  };

  const result = await adapter(spec)({}).parallel({
    id: "backgroundable-agent-tool-tracer",
    context: {},
    agents: { parent },
    model: "recording-model",
  });

  expect(result.results.parent.output).toBe("parent finished");
  expect(childInput).toEqual({ topic: "work" });
  expect(childFinished).toBe(false);
  expect(toolResult).toEqual({
    kind: "work.ref",
    id: expect.any(String),
    targetId: "research-agent-identity",
    guarantees: {
      execution: "process-local",
      rejoin: "process-local",
    },
  });
  expect(Object.isFrozen(toolResult)).toBe(true);
  expect(Object.isFrozen((toolResult as { guarantees: unknown }).guarantees)).toBe(true);

  finishChild();
  await vi.waitFor(() => expect(childFinished).toBe(true));
});

it("returns a backgroundable child's structured output in the foreground", async () => {
  const child = agent({
    id: "foreground-child",
    description: "Return one structured result",
    prompt: prompt({
      id: "foreground-child-prompt",
      input: z.object({ topic: z.string() }),
      output: z.object({ topic: z.string(), complete: z.literal(true) }),
      prompt: ({ input }) => input.topic,
    }),
  });
  const parent = agent({
    id: "foreground-parent",
    prompt: prompt({ id: "foreground-parent-prompt", prompt: () => "parent" }),
    tools: { research: backgroundable(child) },
  });
  const results: unknown[] = [];
  let parentCalls = 0;
  let childCalls = 0;
  const spec: AdapterSpec<object, object> = {
    providerId: "recording",
    structuredOutput: { accepts: { id: "recording", supportsJsonSchema: true, requiresAllProperties: false, supportsOptionalProperties: true, supportsNullable: true, supportsBooleanSchemas: true, supportsReferences: true, supportsUnions: true, supportsRecursiveSchemas: true, additionalProperties: "must-be-false", unsupportedKeywords: [] } },
    async call(_client, args) {
      if (args.schema) {
        childCalls += 1;
        return { raw: {}, extracted: response('{"topic":"work","complete":true}') };
      }
      parentCalls += 1;
      return {
        raw: {},
        extracted: parentCalls === 1
          ? { ...response(""), toolCalls: [{ id: "foreground-call", name: "research", args: { topic: "work" } }] }
          : response("parent finished"),
      };
    },
    async stream() { throw new Error("not used"); },
    appendToolRound(messages, _assistant, toolResults: ToolResultEntry[]) {
      results.push(toolResults[0]?.output);
      return messages;
    },
    mapSettings: () => ({}),
  };

  const result = await adapter(spec)({}).parallel({
    id: "foreground-backgroundable-agent-tool",
    context: {}, agents: { parent }, model: "recording-model",
  });

  expect(result.results.parent.output).toBe("parent finished");
  expect(childCalls).toBe(1);
  expect(results).toEqual([{ topic: "work", complete: true }]);
});

it("rejects an authored run_in_background input before calling the provider", async () => {
  const child = agent({
    id: "reserved-field-child",
    description: "A child with a conflicting input field",
    prompt: prompt({
      id: "reserved-field-child-prompt",
      input: z.object({ run_in_background: z.boolean() }),
      prompt: () => "child",
    }),
  });
  const parent = agent({
    id: "reserved-field-parent",
    prompt: prompt({ id: "reserved-field-parent-prompt", prompt: () => "parent" }),
    tools: { research: backgroundable(child) },
  });
  let providerCalls = 0;
  const spec: AdapterSpec<object, object> = {
    providerId: "recording",
    structuredOutput: { accepts: { id: "recording", supportsJsonSchema: true, requiresAllProperties: false, supportsOptionalProperties: true, supportsNullable: true, supportsBooleanSchemas: true, supportsReferences: true, supportsUnions: true, supportsRecursiveSchemas: true, additionalProperties: "must-be-false", unsupportedKeywords: [] } },
    async call() {
      providerCalls += 1;
      return { raw: {}, extracted: response("not reached") };
    },
    async stream() { throw new Error("not used"); },
    appendToolRound(messages) { return messages; },
    mapSettings: () => ({}),
  };

  await expect(adapter(spec)({}).parallel({
    id: "backgroundable-agent-tool-reserved-field",
    context: {}, agents: { parent }, model: "recording-model",
  })).rejects.toThrow(
    'Backgroundable Agent tool "research" cannot use reserved input field "run_in_background".',
  );
  expect(providerCalls).toBe(0);
});
