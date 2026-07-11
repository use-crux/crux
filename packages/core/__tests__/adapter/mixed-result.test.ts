import { describe, expect, it } from "vitest";
import type { AssistantContentPart, Message } from "../../src";
import { createResultAccumulator } from "../../src/adapter";
import { createStreamResult } from "../../src/adapter/result-accumulator";

const firstContent = [
  { type: "reasoning", text: "Inspect the attachment." },
  { type: "text", text: "The answer is " },
  {
    type: "image",
    source: {
      type: "data",
      data: new Uint8Array([1, 2, 3]),
      mediaType: "image/png",
    },
  },
  {
    type: "tool-call",
    toolCallId: "call_1",
    toolName: "lookup",
    input: { query: "answer" },
  },
] as const satisfies readonly AssistantContentPart[];

const finalContent = [
  { type: "audio", source: new Uint8Array([4, 5]), mediaType: "audio/wav" },
  { type: "text", text: "42." },
  {
    type: "file",
    source: new URL("https://example.com/result.pdf"),
    mediaType: "application/pdf",
  },
] as const satisfies readonly AssistantContentPart[];

describe("authoritative mixed generation output", () => {
  it("preserves ordered content and derives text across model steps", () => {
    const accumulator = createResultAccumulator();
    accumulator.addStep(step(firstContent, "tool_calls"));
    accumulator.addStep(step(finalContent, "stop"));
    const messages: Message[] = [
      { role: "assistant", content: firstContent },
      { role: "tool", content: "lookup result" },
      { role: "assistant", content: finalContent },
    ];

    const result = accumulator.finalize({ raw: { id: "raw" }, messages, _meta: {} });

    expect(result.content).toEqual([...firstContent, ...finalContent]);
    expect(result.text).toBe("The answer is 42.");
    expect(result.messages).toEqual(messages);
    expect(result.steps.map(({ content }) => content)).toEqual([firstContent, finalContent]);
    expect(result.finalStep).toBe(result.steps.at(-1));
    expect(result.warnings).toEqual([]);
  });

  it("buffers non-text output in stream completion while keeping deltas text-only", async () => {
    const messages: Message[] = [{ role: "assistant", content: finalContent }];
    const rawStream = (async function* () {
      yield { text: "4" };
      yield { text: "2." };
    })();
    const result = createStreamResult({
      rawStream,
      extractTextDelta: (chunk) => (chunk as { text: string }).text,
      completion: async () => ({
        text: "42.",
        content: finalContent,
        messages,
        finishReason: "stop",
      }),
    });

    let streamed = "";
    for await (const delta of result.textStream) streamed += delta;
    const completion = await result.completion;

    expect(streamed).toBe("42.");
    expect(completion.content).toEqual(finalContent);
    expect(completion.text).toBe("42.");
    expect(completion.messages).toEqual(messages);
  });
});

function step(content: readonly AssistantContentPart[], finishReason: string) {
  return {
    content,
    finishReason,
    responseId: undefined,
    modelId: undefined,
  };
}
