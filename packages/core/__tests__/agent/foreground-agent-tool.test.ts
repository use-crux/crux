import { expect, it, vi } from "vitest";
import { z } from "zod";
import {
  adapter,
  prompt,
  type AdapterResponse,
  type AdapterSpec,
  type ToolResultEntry,
} from "../../src";
import { agent } from "../../src/agent";
import { currentInternalWorkAttachment } from "../../src/work/internal/attached-context";

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

it("runs a direct child Agent tool as one awaited foreground Work", async () => {
  const childInput = z.object({ topic: z.string() });
  const childOutput = z.object({ summary: z.string(), sources: z.array(z.string()) });
  const exactChildResult = {
    summary: "A structured child result",
    sources: ["source-a", "source-b"],
  };
  const child = agent({
    id: "research-agent-identity",
    description: "Research one topic",
    prompt: prompt({
      id: "foreground-child-prompt",
      input: childInput,
      output: childOutput,
      prompt: ({ input }) => input.topic,
    }),
  });
  const parent = agent({
    id: "parent-agent",
    prompt: prompt({
      id: "foreground-parent-prompt",
      input: z.object({ request: z.string() }),
      prompt: ({ input }) => input.request,
    }),
    tools: { child },
  });

  const providerCalls = vi.fn();
  const childWorkIds = new Set<string>();
  let exactToolResult: unknown;
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
      providerCalls(args);
      const attachment = currentInternalWorkAttachment();
      if (args.schema) {
        expect(attachment).toBeDefined();
        childWorkIds.add(attachment?.parentId ?? "missing-work-id");
        return {
          raw: {},
          extracted: response(JSON.stringify(exactChildResult)),
        };
      }
      expect(attachment).toBeUndefined();
      if (providerCalls.mock.calls.length === 1) {
        expect(args.tools).toHaveLength(1);
        expect(args.tools?.[0]).toMatchObject({
          name: "child",
          description: "Research one topic",
          parameters: z.toJSONSchema(childInput),
        });
        return {
          raw: {},
          extracted: {
            ...response(""),
            toolCalls: [
              { id: "child-call", name: "child", args: { topic: "work" } },
            ],
          },
        };
      }
      return { raw: {}, extracted: response("parent finished") };
    },
    async stream() {
      throw new Error("not used");
    },
    appendToolRound(messages, _assistant, results: ToolResultEntry[]) {
      exactToolResult = results[0]?.output;
      return messages;
    },
    mapSettings: () => ({}),
  };

  const runtime = adapter(spec)({});
  const result = await runtime.parallel({
    id: "foreground-agent-tool-tracer",
    context: { request: "Research work" },
    agents: { parent },
    model: "recording-model",
  });

  expect(result.results.parent.output).toBe("parent finished");
  expect(providerCalls).toHaveBeenCalledTimes(3);
  expect(childWorkIds.size).toBe(1);
  expect(exactToolResult).toEqual(exactChildResult);
});

it("uses an empty object Tool contract and the canonical empty Prompt input", async () => {
  const child = agent({
    id: "inputless-child",
    description: "Run without input",
    prompt: prompt({
      id: "inputless-child-prompt",
      prompt: ({ input }) => {
        expect(input).toEqual({});
        return "child";
      },
    }),
  });
  const parent = agent({
    id: "inputless-parent",
    prompt: prompt({ id: "inputless-parent-prompt", prompt: () => "parent" }),
    tools: { child },
  });
  const providerCalls = vi.fn();
  const spec: AdapterSpec<object, object> = {
    providerId: "recording",
    async call(_client, args) {
      providerCalls(args);
      if (providerCalls.mock.calls.length === 1) {
        expect(args.tools?.[0]?.parameters).toMatchObject({
          type: "object",
          properties: {},
        });
        return {
          raw: {},
          extracted: {
            ...response(""),
            toolCalls: [{ id: "inputless-call", name: "child", args: {} }],
          },
        };
      }
      return { raw: {}, extracted: response("done") };
    },
    async stream() {
      throw new Error("not used");
    },
    appendToolRound: (messages) => messages,
    mapSettings: () => ({}),
  };

  const result = await adapter(spec)({}).parallel({
    id: "inputless-foreground-tool",
    context: {},
    agents: { parent },
    model: "recording-model",
  });

  expect(result.results.parent.output).toBe("done");
  expect(providerCalls).toHaveBeenCalledTimes(3);
});
