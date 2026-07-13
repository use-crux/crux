import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type OpenAI from "openai";
import { fallback } from "@use-crux/core";
import { speechConformanceRow } from "@use-crux/core/adapter/testing";
import { createOpenAI } from "../src";

describe("OpenAI speech", () => {
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
