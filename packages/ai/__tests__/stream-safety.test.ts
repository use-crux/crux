/**
 * Streaming-safety fidelity: the executor mounts core's `SafetyStream` via
 * the REAL `streamText` `experimental_transform`. Proves holds buffer,
 * transforms reach the consumer's `textStream`, blocks error the stream,
 * and the completion meta carries the guardrail audit.
 */

import { describe, it, expect, afterEach } from "vitest";
import { z } from "zod";
import { prompt as makePrompt, guardrail, resetHooks } from "@use-crux/core";
import { boundary } from "@use-crux/core/safety";
import { createCruxAi } from "../src";
import { streamingModel, streamingPartsModel } from "./mock-model";

afterEach(() => {
  resetHooks();
});

const textPrompt = makePrompt({
  id: "stream-safety",
  system: "You are terse.",
  prompt: ({ input }) => (input as { message: string }).message,
  input: z.object({ message: z.string() }),
});

const importFixer = () =>
  guardrail({
    id: "import-fixer",
    on: boundary.output.text(),
    run: async (chunk) => {
      if (chunk.includes("@/comps/")) {
        return {
          action: "rewrite" as const,
          value: chunk.replace("@/comps/", "@/components/"),
          rewrite: { kind: "normalize" as const },
        };
      }
      if (chunk.endsWith("@/co")) return { action: "hold" as const };
      return { action: "allow" as const };
    },
  });

describe("streaming safety through real streamText", () => {
  it("holds, fixes, and releases mid-stream content (LLM Suspense)", async () => {
    const ai = createCruxAi();
    const model = streamingModel([
      "import x from ",
      "@/co",
      "mps/Button",
      " — done",
    ]);

    const result = await ai.stream(textPrompt, {
      model,
      input: { message: "code" },
      guardrails: [importFixer()],
    });

    let streamed = "";
    for await (const delta of result.textStream) {
      streamed += delta;
    }
    expect(streamed).toBe("import x from @/components/Button — done");

    const meta = await result.completion;
    expect(meta.text).toBe("import x from @/components/Button — done");
  });

  it("fails closed instead of releasing a held tail before the finish part", async () => {
    const ai = createCruxAi();
    // The final chunk ends mid-hold, so the tail is only released at seal.
    const model = streamingModel(["hello ", "@/co"]);

    const result = await ai.stream(textPrompt, {
      model,
      input: { message: "code" },
      guardrails: [importFixer()],
    });

    await expect(
      (async () => {
        for await (const _delta of result.textStream) {
          // Consume until the safety transform closes or errors.
        }
      })(),
    ).rejects.toThrow(/hold|stream|safety|result/i);

    await expect(
      (result as unknown as { completion: Promise<{ text?: string }> })
        .completion,
    ).rejects.toThrow(/hold|stream|safety|result/i);
  });

  it("applies ordinary output guardrails to streamText by default", async () => {
    const ai = createCruxAi();
    // Adaptive default is per canonical delta; a custom guard evaluates each delta.
    const model = streamingModel(["api key sk-123."]);
    const redactor = guardrail({
      id: "default-stream-redactor",
      on: boundary.output.text(),
      run: async (content) => ({
        action: "rewrite" as const,
        value: content.replace("sk-123", "[KEY]"),
        rewrite: { kind: "redact" as const },
      }),
    });

    const result = await ai.stream(textPrompt, {
      model,
      input: { message: "code" },
      guardrails: [redactor],
    });

    let streamed = "";
    for await (const delta of result.textStream) {
      streamed += delta;
    }
    expect(streamed).toBe("api key [KEY].");

    const meta = await (
      result as unknown as { completion: Promise<{ text?: string }> }
    ).completion;
    expect(meta?.text).toBe("api key [KEY].");
  });

  it("a mid-stream block surfaces as a stream error", async () => {
    const blocker = guardrail({
      id: "live-block",
      on: boundary.output.text(),
      run: async (chunk) =>
        chunk.includes("forbidden")
          ? { action: "block" as const, reason: "nope" }
          : { action: "allow" as const },
    });
    const ai = createCruxAi();
    const model = streamingModel(["fine ", "forbidden tail"]);

    const result = await ai.stream(textPrompt, {
      model,
      input: { message: "code" },
      guardrails: [blocker],
    });

    const error = await (async () => {
      try {
        let streamed = "";
        for await (const delta of result.textStream) streamed += delta;
        return undefined;
      } catch (caught: unknown) {
        return caught;
      }
    })();

    expect(error).toBeDefined();
  });

  it("uses the authoritative final seal for completion metadata", async () => {
    const seen: string[] = [];
    const result = await createCruxAi().stream(textPrompt, {
      model: streamingModel(["unsafe live"]),
      input: { message: "code" },
      guardrails: [
        guardrail({
          id: "ai-final-seal",
          on: boundary.output.text().complete(),
          run: async (text) => {
            seen.push(text);
            return {
              action: "rewrite" as const,
              value: "safe final",
              rewrite: { kind: "normalize" as const },
            };
          },
        }),
      ],
    });

    let streamed = "";
    for await (const delta of result.textStream) streamed += delta;
    const completion = await result.completion;

    expect(streamed).toBe("unsafe live");
    expect(seen).toEqual(["unsafe live"]);
    expect(completion.text).toBe("safe final");
    expect(completion.content).toEqual([{ type: "text", text: "safe final" }]);
    expect(completion.messages.at(-1)?.content).toEqual(completion.content);
  });

  it("guards completion-only reasoning and media without re-guarding live text", async () => {
    const textSeen: string[] = [];
    const mediaSeen: unknown[] = [];
    const model = streamingPartsModel([
      { type: "reasoning-start", id: "r1" },
      { type: "reasoning-delta", id: "r1", delta: "private reasoning" },
      { type: "reasoning-end", id: "r1" },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "unsafe." },
      { type: "text-end", id: "t1" },
      {
        type: "file",
        data: new Uint8Array([1, 2, 3]),
        mediaType: "image/png",
      },
    ]);
    const result = await createCruxAi().stream(textPrompt, {
      model,
      input: { message: "code" },
      guardrails: [
        guardrail({
          id: "ai-stream-text",
          on: boundary.output.text(),
          run: async (text) => {
            textSeen.push(text);
            return {
              action: "rewrite" as const,
              value: text === "unsafe." ? "safe." : "safe reasoning",
              rewrite: { kind: "normalize" as const },
            };
          },
        }),
        guardrail({
          id: "ai-stream-media",
          on: boundary.output.media(),
          run: async (subject) => {
            mediaSeen.push(subject.origin);
            return { action: "strip" as const, reason: "remove image" };
          },
        }),
      ],
    });

    let streamed = "";
    for await (const delta of result.textStream) streamed += delta;
    const completion = await result.completion;

    expect(streamed).toBe("safe.");
    expect(textSeen).toEqual(["unsafe.", "private reasoning"]);
    expect(mediaSeen).toEqual([{ kind: "step", stepIndex: 0, partIndex: 2 }]);
    expect(completion.content).toEqual([
      { type: "reasoning", text: "safe reasoning" },
      { type: "text", text: "safe." },
    ]);
    expect(completion.text).toBe("safe.");
    expect(completion.finalStep.content).toEqual(completion.content);
    expect(completion.messages.at(-1)?.content).toEqual(completion.content);
  });
});
