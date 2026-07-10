import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { MessageStream } from "@anthropic-ai/sdk/lib/MessageStream";
import { prompt as makePrompt } from "@use-crux/core";
import { createAnthropic } from "../src";

describe("Anthropic stream handling", () => {
  it("falls back to streamed text when finalMessage metadata is unavailable", async () => {
    const requests: unknown[] = [];
    const client = {
      messages: {
        stream: (request: unknown) => {
          requests.push(request);
          return failingCompletionStream();
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

    const completion = await handle.completion;
    expect(completion).toMatchObject({
      text: "partial",
      steps: 1,
      finalStep: {
        text: "partial",
        finishReason: undefined,
        responseId: undefined,
        modelId: undefined,
      },
    });
    expect(completion.finalStep).not.toHaveProperty("usage");
    expect(chunks.join("")).toBe("partial");
    expect(requests).toHaveLength(1);
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
