import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type OpenAI from "openai";
import { fallback } from "@use-crux/core";
import { speechConformanceRow } from "@use-crux/core/adapter/testing";
import { boundary, guardrail } from "@use-crux/core/safety";
import { createOpenAI } from "../src";

describe("OpenAI speech", () => {
  it("guards speech options around the native request and canonical audio", async () => {
    const raw = new Response(new Uint8Array([1, 2, 3]));
    const create = vi.fn(async (_body: unknown, _options?: unknown) => raw);
    const result = await createOpenAI(client(create)).generateSpeech({
      model: "gpt-4o-mini-tts",
      text: "private speech",
      guardrails: [
        guardrail({
          id: "openai-speech-input",
          on: boundary.input.text(),
          run: () => ({
            action: "rewrite",
            value: "guarded speech",
            rewrite: { kind: "redact" },
          }),
        }),
        guardrail({
          id: "openai-speech-output",
          on: boundary.output.media(),
          run: () => ({ action: "allow" }),
        }),
      ],
      safety: { tune: { "openai-speech-output": { mode: "report" } } },
    });

    expect(create.mock.calls[0]?.[0]).toMatchObject({
      input: "guarded speech",
    });
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("guardrails");
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("safety");
    expect(result.raw).toBe(raw);
    expect(
      result.safety?.guardrails?.applied.map((entry) => entry.guard),
    ).toEqual(["openai-speech-input", "openai-speech-output"]);
  });

  it("performs one native call and returns immediately usable audio bytes", async () => {
    expect(speechConformanceRow("openai").support).toBe("native");
    const raw = new Response(new Uint8Array([1, 2, 3]));
    const create = vi.fn(async () => raw);
    const openai = createOpenAI(client(create));

    const result = await openai.generateSpeech({
      model: fallback(["gpt-4o-mini-tts", "gpt-4o-mini-tts-2025-12-15"]),
      text: "Hello from Crux",
      voice: { id: "voice_123" },
      outputFormat: "wav",
      instructions: "Speak warmly",
      speed: 1.25,
    });

    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(
      {
        model: "gpt-4o-mini-tts",
        input: "Hello from Crux",
        voice: { id: "voice_123" },
        response_format: "wav",
        instructions: "Speak warmly",
        speed: 1.25,
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(result.raw).toBe(raw);
    expect(result.audio).toMatchObject({
      type: "data",
      mediaType: "audio/wav",
    });
    expect([...(result.audio.data as Uint8Array)]).toEqual([1, 2, 3]);
    expect(result.execution).toEqual({ kind: "native", calls: 1 });
    expect(result.warnings).toEqual([]);
    expectTypeOf(openai.generateSpeech).toBeFunction();
  });

  it("rejects unsupported portable controls before I/O and preserves native errors", async () => {
    const providerError = new Error("native speech failed");
    const create = vi.fn(async () => Promise.reject(providerError));
    const openai = createOpenAI(client(create));

    await expect(
      openai.generateSpeech({
        model: "tts-1",
        text: "Hello",
        language: "en",
      }),
    ).rejects.toMatchObject({ code: "unsupported_capability" });
    expect(create).not.toHaveBeenCalled();

    await expect(
      openai.generateSpeech({
        model: "custom-speech-model",
        text: "Hello",
        voice: "alloy",
      }),
    ).rejects.toBe(providerError);
  });

  it("rejects SSE speech responses before I/O even through a runtime cast", async () => {
    const create = vi.fn();
    const openai = createOpenAI(client(create));
    await expect(
      openai.generateSpeech({
        model: "gpt-4o-mini-tts",
        text: "Hello",
        extra: { stream_format: "sse" },
      } as never),
    ).rejects.toMatchObject({ code: "unsupported_capability" });
    expect(create).not.toHaveBeenCalled();
  });
});

function client(create: ReturnType<typeof vi.fn>): OpenAI {
  return { audio: { speech: { create } } } as unknown as OpenAI;
}
