import { describe, expect, it } from "vitest";
import type {
  ChatCompletion,
  ChatCompletionChunk,
} from "openai/resources/chat/completions";
import { openAIResponse } from "../src/response";
import {
  createOpenAIStreamCapture,
  openAIStreamCompletion,
} from "../src/stream";

describe("OpenAI tool-call argument parity between generate() and stream()", () => {
  const cases: Array<{ label: string; raw: string; expected: unknown }> = [
    { label: "empty arguments", raw: "", expected: "" },
    {
      label: "malformed JSON arguments",
      raw: "{not-json",
      expected: "{not-json",
    },
    {
      label: "valid JSON arguments",
      raw: '{"city":"Paris"}',
      expected: { city: "Paris" },
    },
  ];

  for (const { label, raw, expected } of cases) {
    it(`produces identical args for ${label}`, async () => {
      const generated = openAIResponse(toolCallCompletion(raw));
      expect(generated.toolCalls?.[0]?.args).toEqual(expected);

      const streamed = createOpenAIStreamCapture(toolCallStream(raw));
      const chunks: ChatCompletionChunk[] = [];
      for await (const chunk of streamed) chunks.push(chunk);
      const streamMeta = await openAIStreamCompletion(chunks);
      expect(streamMeta?.toolCalls?.[0]?.args).toEqual(expected);

      expect(streamMeta?.toolCalls?.[0]?.args).toEqual(
        generated.toolCalls?.[0]?.args,
      );
    });
  }
});

it("preserves a streamed refusal in normalized completion metadata", async () => {
  const chunks: ChatCompletionChunk[] = [
    {
      id: "chatcmpl_refusal",
      object: "chat.completion.chunk",
      created: 0,
      model: "gpt-actual",
      choices: [
        {
          index: 0,
          delta: { refusal: "I cannot help with that." },
          finish_reason: "stop",
          logprobs: null,
        },
      ],
    } as ChatCompletionChunk,
  ];

  await expect(openAIStreamCompletion(chunks)).resolves.toMatchObject({
    finishReason: "refusal",
  });
});

function toolCallCompletion(rawArgs: string): ChatCompletion {
  return {
    id: "chatcmpl_parity",
    object: "chat.completion",
    created: 0,
    model: "gpt-actual",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          refusal: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "lookup", arguments: rawArgs },
            },
          ],
        },
        finish_reason: "tool_calls",
        logprobs: null,
      },
    ],
    usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
  } as unknown as ChatCompletion;
}

function toolCallStream(rawArgs: string): AsyncIterable<ChatCompletionChunk> {
  return (async function* stream() {
    yield {
      model: "gpt-actual",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                function: { name: "lookup", arguments: "" },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    };
    if (rawArgs.length > 0) {
      yield {
        model: "gpt-actual",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { arguments: rawArgs } }],
            },
            finish_reason: null,
          },
        ],
      };
    }
    yield {
      model: "gpt-actual",
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
    };
  })() as AsyncIterable<ChatCompletionChunk>;
}
