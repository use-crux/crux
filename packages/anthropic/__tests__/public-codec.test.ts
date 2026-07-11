import { describe, expect, it } from "vitest";
import { z } from "zod";
import { prompt } from "@use-crux/core";
import { fromResponse, toParams } from "../src";
import type { AnthropicParsedMessage } from "../src/response";

describe("public Anthropic codecs", () => {
  it("turns a resolved prompt into Anthropic params and normalizes the response", async () => {
    const p = prompt({
      id: "anthropic-codec-test",
      system: "Speak plainly.",
      prompt: ({ input }) => `Say ${input.word}.`,
      input: z.object({ word: z.string() }),
      settings: { temperature: 0.2 },
    });

    const resolved = await p.resolve({
      input: { word: "hello" },
      provider: "anthropic",
      modelId: "claude-codec",
    });
    const params = toParams(resolved, {
      model: "claude-codec",
      settings: { maxTokens: 123 },
    });

    expect(params).toMatchObject({
      model: "claude-codec",
      system: "Speak plainly.",
      max_tokens: 123,
      temperature: 0.2,
      messages: [{ role: "user", content: "Say hello." }],
    });

    const facts = fromResponse({
      id: "msg_codec",
      type: "message",
      role: "assistant",
      model: "claude-codec-actual",
      content: [{ type: "text", text: "hello" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 3, output_tokens: 4 },
    } as AnthropicParsedMessage);

    expect(facts).toMatchObject({
      text: "hello",
      finishReason: "end_turn",
      responseId: "msg_codec",
      actualModelId: "claude-codec-actual",
      usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
    });
  });

  it("returns reasoning and tool calls in provider order", () => {
    const facts = fromResponse({
      id: "msg_mixed",
      type: "message",
      role: "assistant",
      model: "claude-thinking",
      content: [
        { type: "thinking", thinking: "checking privately", signature: "sig" },
        { type: "text", text: "I will inspect it." },
        { type: "tool_use", id: "tc_1", name: "inspect", input: { page: 1 } },
      ],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 3, output_tokens: 4 },
    } as unknown as AnthropicParsedMessage);

    expect(facts.content).toEqual([
      { type: "reasoning", text: "checking privately" },
      { type: "text", text: "I will inspect it." },
      {
        type: "tool-call",
        toolCallId: "tc_1",
        toolName: "inspect",
        input: { page: 1 },
      },
    ]);
  });
});
