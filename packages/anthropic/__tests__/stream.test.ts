import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { MessageStream } from "@anthropic-ai/sdk/lib/MessageStream";
import { prompt as makePrompt } from "@use-crux/core";
import { CruxAdapterError, isCruxAdapterError } from "@use-crux/core/adapter";
import { createAnthropic } from "../src";

describe("Anthropic stream handling", () => {
  it("surfaces a finalMessage() rejection as a normalized error instead of swallowing it", async () => {
    const client = {
      messages: {
        stream: () => failingCompletionStream(),
      },
    } as unknown as Anthropic;

    const adapter = createAnthropic(client);
    const handle = await adapter.stream(
      makePrompt({ id: "anthropic-stream", prompt: "Hello" }),
      { model: "claude-sonnet-4-5-20250929" },
    );

    // The text stream still yields whatever arrived before the failure.
    const chunks: string[] = [];
    for await (const chunk of handle.textStream) chunks.push(chunk);
    expect(chunks.join("")).toBe("partial");

    // The completion must now REJECT (previously it silently returned undefined).
    await expect(handle.completion).rejects.toSatisfy((error: unknown) => {
      if (!isCruxAdapterError(error)) return false;
      expect(error).toBeInstanceOf(CruxAdapterError);
      expect(error.providerError.code).toBe(
        "anthropic.stream_completion_failed",
      );
      expect(error.providerError.retryable).toBe(true);
      return true;
    });
  });

  it("normalizes finishReason, usage, and model on a successful stream completion", async () => {
    const client = {
      messages: {
        stream: () =>
          succeedingStream(["par", "tial"], {
            stop_reason: "end_turn",
            usage: { input_tokens: 5, output_tokens: 2 },
            model: "claude-actual",
          }),
      },
    } as unknown as Anthropic;

    const adapter = createAnthropic(client);
    const handle = await adapter.stream(
      makePrompt({ id: "anthropic-stream-ok", prompt: "Hello" }),
      { model: "claude-sonnet-4-5-20250929" },
    );
    for await (const _ of handle.textStream) void _;

    const completion = await handle.completion;
    expect(completion.finalStep.finishReason).toBe("stop");
    expect(completion.finalStep.usage?.totalTokens).toBe(7);
    expect(completion.finalStep.modelId).toBe("claude-actual");
  });

  it("maps a tool_use stream completion to a completed tool-call finish reason without leaking partial tool JSON", async () => {
    const client = {
      messages: {
        stream: () =>
          succeedingStream(["Look", "ing"], {
            stop_reason: "tool_use",
            usage: { input_tokens: 3, output_tokens: 1 },
            model: "claude-actual",
            toolUse: { id: "call_1", name: "lookup", input: { q: "weather" } },
          }),
      },
    } as unknown as Anthropic;

    const adapter = createAnthropic(client);
    const handle = await adapter.stream(
      makePrompt({ id: "anthropic-stream-tool", prompt: "Hello" }),
      { model: "claude-sonnet-4-5-20250929" },
    );

    const streamed: string[] = [];
    for await (const chunk of handle.textStream) streamed.push(chunk);
    // Only assistant text is exposed on the stream, never tool-argument fragments.
    expect(streamed.join("")).toBe("Looking");
    expect(streamed.join("")).not.toContain("weather");

    const completion = await handle.completion;
    expect(completion.finalStep.finishReason).toBe("tool-calls");
  });
});

function failingCompletionStream(): MessageStream {
  return {
    async *[Symbol.asyncIterator]() {
      yield {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "partial" },
      };
    },
    finalMessage: async () => {
      throw new Error("stream closed before final message");
    },
  } as unknown as MessageStream;
}

function succeedingStream(
  chunks: readonly string[],
  final: {
    readonly stop_reason: string;
    readonly usage: { input_tokens: number; output_tokens: number };
    readonly model: string;
    readonly toolUse?: { id: string; name: string; input: Record<string, unknown> };
  },
): MessageStream {
  const content: unknown[] = [{ type: "text", text: chunks.join("") }];
  if (final.toolUse) {
    content.push({
      type: "tool_use",
      id: final.toolUse.id,
      name: final.toolUse.name,
      input: final.toolUse.input,
    });
  }
  return {
    async *[Symbol.asyncIterator]() {
      for (const text of chunks) {
        yield { type: "content_block_delta", delta: { type: "text_delta", text } };
      }
    },
    finalMessage: async () => ({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: final.model,
      content,
      stop_reason: final.stop_reason,
      stop_sequence: null,
      usage: final.usage,
    }),
  } as unknown as MessageStream;
}
