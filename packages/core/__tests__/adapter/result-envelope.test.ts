import { describe, expect, it } from "vitest";
import { z } from "zod";
import { adapter as makeAdapter } from "../../src/adapter/define-adapter";
import type { AdapterSpec } from "../../src/adapter/spec";
import type {
  AdapterResponse,
  CallArgs,
  StreamHandle,
  ToolResultEntry,
} from "../../src/adapter/types";
import type { Message } from "../../src/generation/messages";
import type { TokenUsage } from "../../src/generation/types";
import { prompt as makePrompt } from "../../src/prompt/prompt";

interface EnvelopeClient {
  readonly responses: EnvelopeRawResponse[];
  readonly stream?: EnvelopeStream;
}

interface EnvelopeRawResponse {
  readonly id: string;
  readonly model: string;
  readonly text: string;
  readonly usage?: TokenUsage;
  readonly toolCalls?: AdapterResponse["toolCalls"];
  readonly finishReason?: string;
}

type EnvelopeStream = AsyncIterable<{ readonly text: string }>;

const firstUsage: TokenUsage = {
  inputTokens: 2,
  outputTokens: 3,
  totalTokens: 5,
  inputTokenDetails: { cacheReadTokens: 1 },
  outputTokenDetails: {},
};

const finalUsage: TokenUsage = {
  inputTokens: 4,
  outputTokens: 5,
  totalTokens: 9,
  inputTokenDetails: { cacheWriteTokens: 2 },
  outputTokenDetails: { reasoningTokens: 3 },
};

describe("adapter result envelope", () => {
  it("accumulates text and usage while preserving final-step facts", async () => {
    const runtime = makeAdapter(createEnvelopeSpec())({
      responses: [
        {
          id: "resp_1",
          model: "envelope-model-actual",
          text: "looking up ",
          usage: firstUsage,
          toolCalls: [
            { id: "call_lookup", name: "lookup", args: { query: "weather" } },
          ],
        },
        {
          id: "resp_2",
          model: "envelope-model-actual",
          text: "done",
          usage: finalUsage,
        },
      ],
    });

    const result = await runtime.generate(envelopePrompt(), {
      model: "envelope-model",
      input: { instruction: "Use the lookup tool." },
      tools: {
        lookup: {
          description: "Lookup a value.",
          parameters: z.object({ query: z.string() }),
          execute: async () => "sunny",
        },
      },
    });

    expect(result).toMatchObject({
      text: "looking up done",
      usage: {
        inputTokens: 6,
        outputTokens: 8,
        totalTokens: 14,
        inputTokenDetails: { cacheReadTokens: 1, cacheWriteTokens: 2 },
        outputTokenDetails: { reasoningTokens: 3 },
      },
      steps: expect.arrayContaining([expect.objectContaining({ text: "looking up " }), expect.objectContaining({ text: "done" })]),
      finalStep: {
        text: "done",
        usage: finalUsage,
        finishReason: "stop",
        responseId: "resp_2",
        modelId: "envelope-model-actual",
      },
    });
    expect(result.cost).toBeUndefined();
    expect(result._meta.usage).toEqual(finalUsage);
  });

  it("omits accumulated usage when any provider-call step is unmetered", async () => {
    const runtime = makeAdapter(createEnvelopeSpec())({
      responses: [
        {
          id: "resp_1",
          model: "envelope-model-actual",
          text: "checking ",
          toolCalls: [
            { id: "call_lookup", name: "lookup", args: { query: "weather" } },
          ],
        },
        {
          id: "resp_2",
          model: "envelope-model-actual",
          text: "done",
          usage: finalUsage,
        },
      ],
    });

    const result = await runtime.generate(envelopePrompt(), {
      model: "envelope-model",
      input: { instruction: "Use the lookup tool." },
      tools: {
        lookup: {
          description: "Lookup a value.",
          parameters: z.object({ query: z.string() }),
          execute: async () => "sunny",
        },
      },
    });

    expect(result.text).toBe("checking done");
    expect(result.usage).toBeUndefined();
    expect(result.finalStep).toMatchObject({
      text: "done",
      usage: finalUsage,
      finishReason: "stop",
      responseId: "resp_2",
      modelId: "envelope-model-actual",
    });
    expect(result._meta.usage).toEqual(finalUsage);
  });

  it("returns a canonical stream result with textStream, raw, and completion envelope", async () => {
    const rawStream = Object.assign(streamFrom(["he", "llo"]), {
      providerHandle: "envelope-stream",
    } as const);
    const runtime = makeAdapter(createEnvelopeSpec())({
      responses: [],
      stream: rawStream,
    });

    const result = await runtime.stream(envelopePrompt(), {
      model: "envelope-model",
      input: { instruction: "Stream a greeting." },
    });

    const chunks: string[] = [];
    for await (const delta of result.textStream) chunks.push(delta);

    await expect(result.completion).resolves.toMatchObject({
      text: "hello",
      usage: finalUsage,
      steps: [expect.objectContaining({ text: "hello" })],
      finalStep: {
        text: "hello",
        usage: finalUsage,
        finishReason: "stop",
        responseId: "stream_resp_1",
        modelId: "envelope-model-actual",
      },
      messages: expect.any(Array),
    });
    expect(chunks).toEqual(["he", "llo"]);
    expect(result.raw).toBe(rawStream);
    expect(typeof result.raw[Symbol.asyncIterator]).toBe("function");
  });
});

function envelopePrompt() {
  return makePrompt({
    id: "result-envelope-prompt",
    prompt: ({ input }) => input.instruction,
    input: z.object({ instruction: z.string() }),
  });
}

function createEnvelopeSpec(): AdapterSpec<
  EnvelopeClient,
  EnvelopeRawResponse,
  EnvelopeStream
> {
  return {
    providerId: "envelope",
    async call(client, args) {
      const raw = client.responses.shift();
      if (!raw) throw new Error("Envelope response script exhausted.");
      return { raw, extracted: responseFromRaw(raw) };
    },
    async stream(client): Promise<StreamHandle<EnvelopeStream>> {
      const rawStream = client.stream ?? streamFrom([]);
      return {
        raw: rawStream,
        rawStream,
        extractTextDelta: (chunk) =>
          typeof chunk === "object" && chunk !== null && "text" in chunk
            ? String((chunk as { readonly text: unknown }).text)
            : undefined,
        completion: async () => ({
          usage: finalUsage,
          finishReason: "stop",
          responseId: "stream_resp_1",
          actualModelId: "envelope-model-actual",
        }),
      };
    },
    appendToolRound(messages, assistantResponse, toolResults) {
      return [
        ...messages,
        {
          role: "assistant" as const,
          content: assistantResponse.text,
          metadata: { toolCalls: assistantResponse.toolCalls },
        },
        ...toolResults.map((result) => toolMessage(result)),
      ];
    },
    mapSettings(settings) {
      return { ...settings };
    },
  };
}

function responseFromRaw(raw: EnvelopeRawResponse): AdapterResponse {
  return {
    text: raw.text,
    toolCalls: raw.toolCalls,
    usage: raw.usage,
    finishReason:
      raw.finishReason ??
      (raw.toolCalls && raw.toolCalls.length > 0 ? "tool_calls" : "stop"),
    responseId: raw.id,
    actualModelId: raw.model,
  };
}

function toolMessage(result: ToolResultEntry): Message {
  return {
    role: "tool",
    content: result.content,
    metadata: { toolCallId: result.toolCallId, toolName: result.name },
  };
}

function streamFrom(chunks: readonly string[]): EnvelopeStream {
  return {
    async *[Symbol.asyncIterator]() {
      for (const text of chunks) yield { text };
    },
  };
}
