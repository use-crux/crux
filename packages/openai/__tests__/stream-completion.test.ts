import type OpenAI from "openai";
import type { Stream } from "openai/streaming";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";
import { prompt } from "@use-crux/core";
import { describe, expect, it } from "vitest";
import { createOpenAI } from "../src";

describe("OpenAI stream completion", () => {
  it("preserves exact buffered content and canonical messages", async () => {
    const client = {
      chat: { completions: { create: async () => stream() } },
    } as unknown as OpenAI;
    const result = await createOpenAI(client).stream(
      prompt({ id: "openai-stream-content", prompt: "Inspect this." }),
      {
        model: "gpt-audio",
      },
    );

    for await (const _ of result.textStream) {
      /* consume */
    }
    const completion = await result.completion;

    expect(completion.content.map((part) => part.type)).toEqual([
      "text",
      "audio",
      "tool-call",
    ]);
    expect(completion.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: completion.content,
    });
  });
});

function stream(): Stream<ChatCompletionChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      yield chunk({ content: "Listen", audio: { data: "AQ" } });
      yield chunk(
        {
          audio: { data: "ID" },
          tool_calls: [
            {
              index: 0,
              id: "tc_1",
              type: "function",
              function: { name: "inspect", arguments: '{"page":1}' },
            },
          ],
        },
        "tool_calls",
      );
    },
  } as unknown as Stream<ChatCompletionChunk>;
}

function chunk(
  delta: Record<string, unknown>,
  finishReason: ChatCompletionChunk.Choice["finish_reason"] = null,
): ChatCompletionChunk {
  return {
    id: "chunk_1",
    object: "chat.completion.chunk",
    created: 0,
    model: "gpt-audio-actual",
    choices: [{ index: 0, delta, finish_reason: finishReason, logprobs: null }],
  } as unknown as ChatCompletionChunk;
}
