/** Buffered stream-completion Safety through SDK loop runtimes. */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loopRuntimeAdapter } from "../../src/adapter/define-executor";
import { fakeLoopRuntime } from "../../src/adapter/testing";
import { prompt } from "../../src/prompt/prompt";
import { boundary, guardrail } from "../../src/safety";

describe("stream completion media Safety — SDK runtime", () => {
  it("does not start completion work until a caller observes completion", async () => {
    let completionCalls = 0;
    const fake = fakeLoopRuntime({ streams: [[]] });
    const runtime = loopRuntimeAdapter({
      ...fake.runtime,
      async runStream() {
        return {
          raw: Object.freeze({ kind: "lazy-sdk-stream" as const }),
          completion: async () => {
            completionCalls += 1;
            return { text: "done", finishReason: "stop" };
          },
        };
      },
    });

    const handle = await runtime.stream(streamPrompt(), {
      model: "fake:stream-model",
    });

    expect(completionCalls).toBe(0);
    const first = handle.completion();
    const second = handle.completion();
    expect((await first)?.text).toBe("done");
    expect((await second)?.text).toBe("done");
    expect(completionCalls).toBe(1);
  });

  it("guards structured completion text over the live structured stream (canonical, per delta)", async () => {
    const unsafe = '{"value":"unsafe"}';
    const safe = '{"value":"safe"}';
    const seen: string[] = [];
    const raw = Object.freeze({ kind: "sdk-stream" as const });
    const fake = fakeLoopRuntime({ streams: [[]] });
    const runtime = loopRuntimeAdapter({
      ...fake.runtime,
      async runStream(request) {
        // A transport drives the structured stream with provider wire JSON: the
        // text boundary guard observes the canonical serialized text and rewrites
        // it; the sealed text is the completion text.
        expect(request.safety).toBeDefined();
        let released = "";
        const directive = await request.safety!.feed(unsafe);
        if (directive.kind === "emit") released += directive.content;
        const seal = await request.safety!.finish();
        released += seal.pending;
        return {
          raw,
          completion: async () => ({
            text: released,
            content: [{ type: "text" as const, text: released }],
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

  it("preserves native completion facts while adding Core correlation", async () => {
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

    const completion = await handle.completion();
    expect(completion).not.toBe(meta);
    expect(completion).toMatchObject(meta);
    expect(completion?._meta).toEqual(handle._meta);
    expect(completion?.runId).toBe(handle.runId);
    expect(meta).not.toHaveProperty("_meta");
    expect(meta).not.toHaveProperty("runId");
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
