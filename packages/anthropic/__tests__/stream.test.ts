import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { MessageStream } from "@anthropic-ai/sdk/lib/MessageStream";
import { prompt as makePrompt } from "@use-crux/core";
import { createAnthropic } from "../src";

describe("Anthropic stream handling", () => {
  it("preserves exact final content and canonical messages", async () => {
    const client = {
      messages: { stream: () => completedStream() },
    } as unknown as Anthropic;
    const result = await createAnthropic(client).stream(
      makePrompt({ id: "anthropic-stream-content", prompt: "Inspect this." }),
      { model: "claude-sonnet-4-5-20250929" },
    );

    for await (const _ of result.textStream) {
      /* consume */
    }
    const completion = await result.completion;
    expect(completion.content.map((part) => part.type)).toEqual([
      "text",
      "tool-call",
    ]);
    expect(completion.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: completion.content,
    });
  });

  it("propagates finalMessage errors by identity after streamed text", async () => {
    const requests: unknown[] = [];
    const finalMessageError = new Error("stream closed before final message");
    const client = {
      messages: {
        stream: (request: unknown) => {
          requests.push(request);
          return failingCompletionStream(finalMessageError);
        },
      },
    } as unknown as Anthropic;

    const adapter = createAnthropic(client);
    const handle = await adapter.stream(
      makePrompt({ id: "anthropic-stream", prompt: "Hello" }),
      {
        model: "claude-sonnet-4-5-20250929",
      },
    );

    const chunks: string[] = [];
    for await (const chunk of handle.textStream) {
      chunks.push(chunk);
    }

    await expect(handle.completion).rejects.toBe(finalMessageError);
    expect(chunks.join("")).toBe("partial");
    expect(requests).toHaveLength(1);
  });
});

function completedStream(): MessageStream {
  const message = {
    id: "msg_stream",
    type: "message",
    role: "assistant",
    model: "claude-actual",
    content: [
      { type: "text", text: "Checking" },
      { type: "tool_use", id: "tc_1", name: "inspect", input: { page: 1 } },
    ],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 2, output_tokens: 3 },
  } as unknown as Anthropic.Message;
  return {
    async *[Symbol.asyncIterator]() {
      yield {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Checking" },
      };
    },
    finalMessage: async () => message,
  } as unknown as MessageStream;
}

function failingCompletionStream(error: Error): MessageStream {
  return {
    async *[Symbol.asyncIterator]() {
      yield {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "partial" },
      };
    },
    finalMessage: async () => {
      throw error;
    },
  } as unknown as MessageStream;
}
