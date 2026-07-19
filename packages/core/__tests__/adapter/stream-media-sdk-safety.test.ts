/** Buffered stream-completion Safety through SDK loop runtimes. */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loopRuntimeAdapter } from "../../src/adapter/define-executor";
import { fakeLoopRuntime } from "../../src/adapter/testing";
import { prompt } from "../../src/prompt/prompt";
import { boundary, guardrail } from "../../src/safety";

describe("stream completion media Safety — SDK runtime", () => {
  it("guards buffered structured text when no live Safety stream exists", async () => {
    const unsafe = '{"value":"unsafe"}';
    const safe = '{"value":"safe"}';
    const seen: string[] = [];
    const raw = Object.freeze({ kind: "sdk-stream" as const });
    const fake = fakeLoopRuntime({ streams: [[]] });
    const runtime = loopRuntimeAdapter({
      ...fake.runtime,
      async runStream(request) {
        expect(request.safety).toBeUndefined();
        return {
          raw,
          completion: async () => ({
            text: unsafe,
            content: [{ type: "text" as const, text: unsafe }],
            finishReason: "stop",
          }),
        };
      },
    });

    const handle = await runtime.stream(structuredStreamPrompt(), {
      model: "fake:stream-model",
      guardrails: [
        guardrail({
          id: "structured-completion-text",
          on: boundary.output.text(),
          run: (text) => {
            seen.push(text);
            return {
              action: "rewrite",
              value: safe,
              rewrite: { kind: "normalize" },
            };
          },
        }),
      ],
    });

    const completion = await handle.completion();
    expect(seen).toEqual([unsafe]);
    expect(completion?.text).toBe(safe);
    expect(completion?.content).toEqual([{ type: "text", text: safe }]);
  });

  it("passes native completion metadata through unchanged without Safety", async () => {
    const raw = Object.freeze({ kind: "sdk-stream" as const });
    const meta = Object.freeze({
      text: "visible",
      content: Object.freeze([{ type: "text" as const, text: "visible" }]),
      messages: Object.freeze([
        {
          role: "assistant" as const,
          content: "visible",
          metadata: Object.freeze({ native: true }),
        },
      ]),
      finishReason: "stop",
    });
    const fake = fakeLoopRuntime({ streams: [["visible"]] });
    const runtime = loopRuntimeAdapter({
      ...fake.runtime,
      async runStream() {
        return { raw, completion: async () => meta };
      },
    });

    const handle = await runtime.stream(streamPrompt(), {
      model: "fake:stream-model",
    });

    expect(await handle.completion()).toBe(meta);
  });

  it("strips buffered media before completion and preserves the raw handle", async () => {
    const image = Object.freeze({
      type: "image" as const,
      source: new Uint8Array([1, 3, 5]),
      mediaType: "image/png",
    });
    const text = Object.freeze({ type: "text" as const, text: "visible" });
    const raw = Object.freeze({ kind: "sdk-stream" as const });
    const warning = Object.freeze({ code: "native-warning" });
    const providerMetadata = Object.freeze({ provider: "native-metadata" });
    const usage = Object.freeze({
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
    });
    const assistantMetadata = Object.freeze({ native: "assistant-metadata" });
    const seen: unknown[] = [];
    const fake = fakeLoopRuntime({ streams: [["visible"]] });
    const runtime = loopRuntimeAdapter({
      ...fake.runtime,
      async runStream(request) {
        return {
          raw,
          completion: async () => ({
            text: "visible",
            content: [text, image],
            messages: [
              ...(request.messages ?? []),
              {
                role: "assistant" as const,
                content: [text, image],
                metadata: assistantMetadata,
              },
            ],
            finishReason: "stop",
            warnings: [warning],
            providerMetadata,
            usage,
          }),
        };
      },
    });

    const handle = await runtime.stream(streamPrompt(), {
      model: "fake:stream-model",
      guardrails: [
        guardrail({
          id: "strip-sdk-buffered-image",
          on: boundary.output.media(),
          run: (subject) => {
            seen.push(subject.origin);
            return { action: "strip", reason: "remove buffered image" };
          },
        }),
      ],
    });
    const completion = await handle.completion();

    expect(handle.raw).toBe(raw);
    expect(seen).toEqual([{ kind: "step", stepIndex: 0, partIndex: 1 }]);
    expect(completion?.content).toEqual([text]);
    expect(completion?.messages?.at(-1)?.content).toEqual([text]);
    expect(completion?.messages?.at(-1)?.metadata).toBe(assistantMetadata);
    expect(completion?.text).toBe("visible");
    expect(completion?.warnings?.[0]).toBe(warning);
    expect(completion?.providerMetadata).toBe(providerMetadata);
    expect(completion?.usage).toBe(usage);
  });
});

function streamPrompt() {
  return prompt({ id: "stream-media-sdk-safety", prompt: "Stream content." });
}

function structuredStreamPrompt() {
  return prompt({
    id: "structured-stream-completion-safety",
    prompt: "Stream structured content.",
    output: z.object({ value: z.string() }),
  });
}
