/** Buffered stream-completion Safety through the public Core adapter. */

import { describe, expect, it } from "vitest";
import { adapter } from "../../src/adapter/define-adapter";
import type { AdapterSpec } from "../../src/adapter/spec";
import type {
  StreamCompletionMetadata,
  StreamHandle,
} from "../../src/adapter/types";
import { prompt } from "../../src/prompt/prompt";
import { boundary, guardrail } from "../../src/safety";
import type { AssistantContentPart } from "../../src/types/content";

describe("stream completion media Safety — Core", () => {
  it("guards buffered media before completion resolves", async () => {
    const image = Object.freeze({
      type: "image" as const,
      source: new Uint8Array([1, 2, 3]),
      mediaType: "image/png",
    });
    const text = Object.freeze({ type: "text" as const, text: "visible" });
    const content = Object.freeze([text, image]);
    const seen: unknown[] = [];
    const runtime = adapter(streamSpec({ content }))({ kind: "stream-client" });

    const result = await runtime.stream(streamPrompt(), {
      model: "stream-model",
      guardrails: [
        guardrail({
          id: "allow-buffered-image",
          on: boundary.output.media(),
          run: (subject) => {
            seen.push(subject.origin);
            return { action: "allow" };
          },
        }),
      ],
    });

    expect(await collect(result.textStream)).toBe("visible");
    const completion = await result.completion;

    expect(seen).toEqual([{ kind: "step", stepIndex: 0, partIndex: 1 }]);
    expect(completion.content).toEqual(content);
    expect(completion.content[0]).toBe(text);
    expect(completion.content[1]).toBe(image);
    expect(completion.finalStep.content[1]).toBe(image);
    expect(completion.text).toBe("visible");
  });

  it("strips buffered media from content, finalStep, and the assistant message", async () => {
    const image = Object.freeze({
      type: "image" as const,
      source: new Uint8Array([4, 5, 6]),
      mediaType: "image/png",
    });
    const text = Object.freeze({ type: "text" as const, text: "visible" });
    const runtime = adapter(streamSpec({ content: [text, image] }))({
      kind: "stream-client",
    });

    const result = await runtime.stream(streamPrompt(), {
      model: "stream-model",
      guardrails: [
        guardrail({
          id: "strip-buffered-image",
          on: boundary.output.media(),
          run: () => ({ action: "strip", reason: "remove buffered image" }),
        }),
      ],
    });

    expect(await collect(result.textStream)).toBe("visible");
    const completion = await result.completion;

    expect(completion.content).toEqual([text]);
    expect(completion.content[0]).toBe(text);
    expect(completion.finalStep.content).toEqual([text]);
    expect(completion.messages.at(-1)?.content).toEqual([text]);
  });

  it("rejects completion after already emitted text when buffered media blocks", async () => {
    const image = Object.freeze({
      type: "image" as const,
      source: new Uint8Array([7, 8, 9]),
      mediaType: "image/png",
    });
    const runtime = adapter(
      streamSpec({
        content: [{ type: "text", text: "visible" }, image],
      }),
    )({ kind: "stream-client" });

    const result = await runtime.stream(streamPrompt(), {
      model: "stream-model",
      guardrails: [
        guardrail({
          id: "block-buffered-image",
          on: boundary.output.media(),
          run: () => ({ action: "block", reason: "reject completion" }),
        }),
      ],
    });

    expect(await collect(result.textStream)).toBe("visible");
    await expect(result.completion).rejects.toThrow("block-buffered-image");
  });

  it("does not re-guard streamed text and guards completion-only reasoning once", async () => {
    const seen: string[] = [];
    const content = [
      { type: "text" as const, text: "unsafe." },
      { type: "reasoning" as const, text: "private reasoning" },
    ];
    const runtime = adapter(streamSpec({ content, chunks: ["unsafe."] }))({
      kind: "stream-client",
    });

    const result = await runtime.stream(streamPrompt(), {
      model: "stream-model",
      guardrails: [
        guardrail({
          id: "rewrite-live-and-completion-only-text",
          on: boundary.output.text(),
          stream: "chunk",
          run: (text) => {
            seen.push(text);
            return text === "unsafe."
              ? {
                  action: "rewrite",
                  value: "safe.",
                  rewrite: { kind: "normalize" },
                }
              : text === "private reasoning"
                ? {
                    action: "rewrite",
                    value: "safe reasoning",
                    rewrite: { kind: "normalize" },
                  }
                : { action: "allow" };
          },
        }),
      ],
    });

    expect(await collect(result.textStream)).toBe("safe.");
    const completion = await result.completion;

    expect(seen).toEqual(["unsafe.", "private reasoning"]);
    expect(completion.content).toEqual([
      { type: "text", text: "safe." },
      { type: "reasoning", text: "safe reasoning" },
    ]);
    expect(completion.text).toBe("safe.");
    expect(completion.finalStep.content).toEqual(completion.content);
    expect(completion.messages.at(-1)?.content).toEqual(completion.content);
  });

  it("guards buffered text once when no live text slot was emitted", async () => {
    const seen: string[] = [];
    const runtime = adapter(
      streamSpec({
        content: [{ type: "text", text: "buffered only" }],
        chunks: [],
      }),
    )({ kind: "stream-client" });

    const result = await runtime.stream(streamPrompt(), {
      model: "stream-model",
      guardrails: [
        guardrail({
          id: "rewrite-completion-only-text",
          on: boundary.output.text(),
          run: (text) => {
            seen.push(text);
            return {
              action: "rewrite",
              value: "guarded buffer",
              rewrite: { kind: "normalize" },
            };
          },
        }),
      ],
    });

    expect(await collect(result.textStream)).toBe("");
    const completion = await result.completion;

    expect(seen).toEqual(["buffered only"]);
    expect(completion.text).toBe("guarded buffer");
    expect(completion.content).toEqual([
      { type: "text", text: "guarded buffer" },
    ]);
    expect(completion.messages.at(-1)?.content).toEqual(completion.content);
  });

  it("guards a buffered-only text slot following represented live text", async () => {
    const seen: string[] = [];
    const runtime = adapter(
      streamSpec({
        content: [
          { type: "text", text: "unsafe." },
          { type: "text", text: "buffered appendix" },
        ],
        chunks: ["unsafe."],
      }),
    )({ kind: "stream-client" });

    const result = await runtime.stream(streamPrompt(), {
      model: "stream-model",
      guardrails: [
        guardrail({
          id: "separate-live-and-buffered-text",
          on: boundary.output.text(),
          stream: "chunk",
          run: (text) => {
            seen.push(text);
            return {
              action: "rewrite",
              value: text === "unsafe." ? "safe." : "guarded appendix",
              rewrite: { kind: "normalize" },
            };
          },
        }),
      ],
    });

    expect(await collect(result.textStream)).toBe("safe.");
    const completion = await result.completion;

    expect(seen).toEqual(["unsafe.", "buffered appendix"]);
    expect(completion.content).toEqual([
      { type: "text", text: "safe." },
      { type: "text", text: "guarded appendix" },
    ]);
    expect(completion.text).toBe("safe.guarded appendix");
    expect(completion.messages.at(-1)?.content).toEqual(completion.content);
  });
});

function streamPrompt() {
  return prompt({
    id: "stream-media-safety",
    prompt: "Stream visible content.",
  });
}

function streamSpec(options: {
  readonly content: readonly AssistantContentPart[];
  readonly chunks?: readonly string[];
}): AdapterSpec<
  { readonly kind: "stream-client" },
  never,
  AsyncIterable<{ readonly text: string }>
> {
  return {
    providerId: "stream-safety",
    async call() {
      throw new Error("not used");
    },
    async stream(): Promise<
      StreamHandle<AsyncIterable<{ readonly text: string }>>
    > {
      const rawStream = (async function* () {
        for (const text of options.chunks ?? ["visible"]) yield { text };
      })();
      return {
        rawStream,
        extractTextDelta: (chunk) => (chunk as { readonly text?: string }).text,
        completion: async (): Promise<StreamCompletionMetadata> => ({
          text: (options.chunks ?? ["visible"]).join(""),
          content: options.content,
          finishReason: "stop",
        }),
      };
    },
    appendToolRound: (messages) => messages,
    mapSettings: (settings) => ({ ...settings }),
  };
}

async function collect(stream: AsyncIterable<string>): Promise<string> {
  let text = "";
  for await (const delta of stream) text += delta;
  return text;
}
