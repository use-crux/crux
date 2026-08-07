import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { LanguageModel } from "ai";
import {
  createInMemoryObservabilityTransport,
  fallback,
  observe,
  prompt,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "@use-crux/core";
import { CruxUnsupportedStructuredOutputError } from "@use-crux/core/adapter";
import { createCruxAi } from "../src";
import { mapAiSdkError } from "../src/normalized-outcome";
import {
  aiSdkStructuredCapabilities,
  createAiSdkStructuredOutputResolver,
} from "../src/provider-profile";
import { scriptedGateway } from "./scripted-gateway";

const outputPrompt = prompt({
  id: "capability-route",
  prompt: "json",
  output: z.object({ value: z.string().optional() }),
});

function model(provider: string, modelId: string): LanguageModel {
  return {
    provider,
    modelId,
    specificationVersion: "v3",
  } as unknown as LanguageModel;
}

async function responseSchema(call: Record<string, unknown> | undefined) {
  const output = call?.output as
    | { responseFormat?: Promise<{ schema?: unknown }> }
    | undefined;
  return (await output?.responseFormat)?.schema;
}

describe("AI SDK structured-output capability routing", () => {
  afterEach(() => resetObservabilityRuntime());

  it("infers only trustworthy direct-provider identities", () => {
    expect(
      aiSdkStructuredCapabilities({
        provider: "openrouter",
        modelId: "openai/gpt-5",
      }),
    ).toBeUndefined();
    expect(
      aiSdkStructuredCapabilities({
        provider: "openai-compatible",
        modelId: "gpt-5",
      }),
    ).toBeUndefined();
    expect(
      aiSdkStructuredCapabilities({
        provider: "vertex-proxy",
        modelId: "gemini",
      }),
    ).toBeUndefined();
    expect(
      aiSdkStructuredCapabilities({ provider: "openai", modelId: "gpt-5" })?.id,
    ).toBe("ai-sdk.openai");
    expect(
      aiSdkStructuredCapabilities({
        provider: "anthropic.messages",
        modelId: "claude",
      })?.id,
    ).toBe("ai-sdk.anthropic");
    expect(
      aiSdkStructuredCapabilities({
        provider: "google.generative-ai",
        modelId: "gemini",
      })?.id,
    ).toBe("ai-sdk.google");
    expect(
      aiSdkStructuredCapabilities({ provider: "vertex", modelId: "gemini" })
        ?.id,
    ).toBe("ai-sdk.google");
  });

  it("passes an unknown model schema through unchanged", async () => {
    const scripted = scriptedGateway({
      generateText: [{ output: { value: "ok" } }],
    });
    const ai = createCruxAi({ gateway: scripted.gateway });
    await ai.generate(outputPrompt, {
      model: model("openrouter", "openai/gpt-5"),
    });
    const wire = await responseSchema(scripted.calls.generateText[0]);
    expect(wire).toMatchObject({
      type: "object",
      properties: { value: { type: "string" } },
    });
    expect(wire).not.toHaveProperty("required");
  });

  it("gives an explicit factory profile precedence", async () => {
    const scripted = scriptedGateway({
      generateText: [{ output: { value: null } }],
    });
    const capabilities = aiSdkStructuredCapabilities({
      provider: "openai",
      modelId: "gpt-5",
    })!;
    const ai = createCruxAi({
      gateway: scripted.gateway,
      structuredOutput: { capabilities },
    });
    await ai.generate(outputPrompt, { model: model("custom", "model") });
    expect(await responseSchema(scripted.calls.generateText[0])).toMatchObject({
      required: ["value"],
      additionalProperties: false,
    });
  });

  it("passes raw tool schemas through without vocabulary checks or owner mutation", async () => {
    const schema = { type: "object", dependentRequired: { a: ["b"] } };
    const scripted = scriptedGateway({ generateText: [{ text: "done" }] });
    await createCruxAi({ gateway: scripted.gateway }).generate(
      prompt({ id: "raw-tool-passthrough", prompt: "use it" }),
      {
        model: model("openrouter", "openai/gpt-5"),
        tools: {
          save: { inputSchema: schema, execute: async () => "ok" },
        } as never,
      },
    );
    const toolSchema = (
      scripted.calls.generateText[0]?.tools as Record<
        string,
        { inputSchema?: { jsonSchema?: unknown } }
      >
    ).save.inputSchema?.jsonSchema;
    expect(toolSchema).toEqual(schema);
    expect(Object.isFrozen(schema)).toBe(false);
  });

  it("applies the resolver to stream, tool input, and generateObjectFn", async () => {
    const usages: string[] = [];
    const resolver = (
      context: Parameters<
        ReturnType<typeof createAiSdkStructuredOutputResolver>
      >[0],
    ) => {
      usages.push(context.usage);
      return undefined;
    };
    const scripted = scriptedGateway({
      streamText: [{ chunks: [], finish: { output: { value: "ok" } } }],
      generateText: [{ text: "done" }, { output: { value: "ok" } }],
    });
    const ai = createCruxAi({
      gateway: scripted.gateway,
      structuredOutput: { capabilities: resolver },
    });
    await ai.stream(outputPrompt, { model: model("custom", "stream") });
    await ai.generate(prompt({ id: "resolver-tool", prompt: "use it" }), {
      model: model("custom", "tool"),
      tools: {
        save: {
          inputSchema: z.object({ value: z.string() }),
          execute: async () => "ok",
        },
      } as never,
    });
    await ai.generateObjectFn({
      model: model("custom", "object"),
      schema: z.object({ value: z.string() }),
      prompt: "json",
    });
    expect(usages.filter((usage) => usage === "output")).toHaveLength(2);
    expect(usages).toContain("tool-input");
    expect(
      await responseSchema(scripted.calls.streamText[0]),
    ).not.toHaveProperty("required");
  });

  it("rejects unknown output models before transport when configured", async () => {
    const scripted = scriptedGateway();
    const ai = createCruxAi({
      gateway: scripted.gateway,
      structuredOutput: { unknownModel: "reject" },
    });
    await expect(
      ai.generate(outputPrompt, { model: model("custom", "strict") }),
    ).rejects.toBeInstanceOf(CruxUnsupportedStructuredOutputError);
    expect(scripted.calls.generateText).toHaveLength(0);
  });

  it("falls through per-candidate local schema incompatibility and records exhaustion", async () => {
    const strict = aiSdkStructuredCapabilities({
      provider: "openai",
      modelId: "gpt-5",
    })!;
    const schema = z.union([
      z.object({ config: z.object({ note: z.string().optional() }) }),
      z.object({ config: z.string() }),
    ]);
    const scripted = scriptedGateway({
      generateText: [{ output: { config: "plain" } }],
    });
    const ai = createCruxAi({
      gateway: scripted.gateway,
      structuredOutput: {
        capabilities: ({ model: info }) =>
          info.modelId.startsWith("strict") ? strict : undefined,
      },
    });
    const result = await ai.generateObjectFn({
      model: fallback([model("custom", "strict-a"), model("custom", "backup")]),
      schema,
      prompt: "json",
    });
    expect(result.object).toEqual({ config: "plain" });
    expect(result.routing?.trace[0]).toMatchObject({
      attempts: [
        {
          model: "strict-a",
          status: "error",
          errorCategory: "schema_incompatible",
        },
        { model: "backup", status: "ok" },
      ],
    });

    await expect(
      ai.generateObjectFn({
        model: fallback([
          model("custom", "strict-a"),
          model("custom", "strict-b"),
        ]),
        schema,
        prompt: "json",
      }),
    ).rejects.toMatchObject({
      attempts: [
        { model: "strict-a", errorCategory: "schema_incompatible" },
        { model: "strict-b", errorCategory: "schema_incompatible" },
      ],
    });
  });

  it("classifies only evidenced provider schema rejection", () => {
    const evidenced = Object.assign(
      new Error("response_format JSON schema is unsupported"),
      { statusCode: 400 },
    );
    const generic = Object.assign(new Error("invalid request"), {
      statusCode: 400,
    });
    const genericSchema = Object.assign(
      new Error("request schema is invalid"),
      { statusCode: 422 },
    );
    const normalized = mapAiSdkError(evidenced)!;
    expect(normalized.code).toBe("ai-sdk.schema_rejected");
    expect(mapAiSdkError(generic)?.code).toBe("ai-sdk.invalid_request");
    expect(mapAiSdkError(genericSchema)?.code).toBe("ai-sdk.invalid_request");
  });

  it("classifies function schema rejection without widening generic 400s", () => {
    const functionSchema = Object.assign(
      new Error("Invalid schema for function 'save'"),
      { statusCode: 400 },
    );
    const genericFunction = Object.assign(
      new Error("Invalid function 'save'"),
      { statusCode: 400 },
    );

    expect(mapAiSdkError(functionSchema)?.code).toBe(
      "ai-sdk.schema_rejected",
    );
    expect(mapAiSdkError(genericFunction)?.code).toBe(
      "ai-sdk.invalid_request",
    );
  });

  it("falls back on evidenced provider schema rejection but not a generic 400", async () => {
    const rejected = Object.assign(
      new Error("response_format JSON schema is unsupported"),
      { statusCode: 400 },
    );
    const scripted = scriptedGateway({
      generateText: [rejected, { output: { value: "ok" } }],
    });
    const ai = createCruxAi({ gateway: scripted.gateway });
    await expect(
      ai.generateObjectFn({
        model: fallback([model("custom", "first"), model("custom", "second")]),
        schema: z.object({ value: z.string() }),
        prompt: "json",
      }),
    ).resolves.toMatchObject({ object: { value: "ok" } });

    const generic = Object.assign(new Error("invalid request"), {
      statusCode: 400,
    });
    const genericGateway = scriptedGateway({
      generateText: [generic, { output: { value: "unused" } }],
    });
    await expect(
      createCruxAi({ gateway: genericGateway.gateway }).generateObjectFn({
        model: fallback([model("custom", "first"), model("custom", "second")]),
        schema: z.object({ value: z.string() }),
        prompt: "json",
      }),
    ).rejects.toBe(generic);
    expect(genericGateway.calls.generateText).toHaveLength(1);
  });

  it("records strategy and profile on generation spans", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const scripted = scriptedGateway({
      generateText: [{ output: { value: "ok" } }],
    });
    await createCruxAi({ gateway: scripted.gateway }).generate(outputPrompt, {
      model: model("openrouter", "openai/gpt-5"),
    });
    await observe.flush();
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "span:start",
        attributes: expect.objectContaining({
          provider: "openrouter",
          model: "openai/gpt-5",
          structuredOutputStrategy: "passthrough",
          structuredOutputProfile: "ai-sdk.passthrough",
        }),
      }),
    );
  });

  it("records structured routing for tools-only generate and stream spans", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const scripted = scriptedGateway({
      generateText: [{ text: "done" }],
      streamText: [{ chunks: ["done"], finish: { finishReason: "stop" } }],
    });
    const ai = createCruxAi({ gateway: scripted.gateway });
    const tools = {
      save: {
        inputSchema: z.object({ value: z.string() }),
        execute: async () => "ok",
      },
    } as never;

    await ai.generate(prompt({ id: "tool-generate", prompt: "save" }), {
      model: model("openai", "gpt-5"),
      tools,
    });
    const streamed = await ai.stream(
      prompt({ id: "tool-stream", prompt: "save" }),
      { model: model("openai", "gpt-5"), tools },
    );
    for await (const _chunk of streamed.textStream) {
      // Drain the stream so completion and its operation span settle.
    }
    await streamed.completion;
    await observe.flush();

    const spans = transport.records.filter(
      (record) =>
        record.type === "span:start" &&
        (record.primitive === "generation.call" ||
          record.primitive === "generation.stream"),
    );
    expect(spans).toHaveLength(2);
    for (const span of spans) {
      expect(span.attributes).toMatchObject({
        provider: "openai",
        model: "gpt-5",
        structuredOutputStrategy: "inferred",
        structuredOutputProfile: "ai-sdk.openai",
      });
    }
  });
});
