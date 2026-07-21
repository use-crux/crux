import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { GoogleGenAI } from "@google/genai";
import { speechConformanceRow } from "@use-crux/core/adapter/testing";
import { boundary, guardrail } from "@use-crux/core/safety";
import { createGoogle } from "../src";

describe("Google speech", () => {
  it("guards speech options around the native request and canonical audio", async () => {
    const raw = {
      candidates: [
        {
          content: {
            parts: [{ inlineData: { data: "AQID", mimeType: "audio/L16" } }],
          },
        },
      ],
    };
    const generateContent = vi.fn(async (_args: unknown) => raw);
    const result = await createGoogle(client(generateContent), {
      cachedContent: false,
    }).generateSpeech({
      model: "gemini-2.5-flash-preview-tts",
      text: "private speech",
      guardrails: [
        guardrail({
          id: "google-speech-input",
          on: boundary.input.text(),
          run: () => ({
            action: "rewrite",
            value: "guarded speech",
            rewrite: { kind: "redact" },
          }),
        }),
        guardrail({
          id: "google-speech-output",
          on: boundary.output.media(),
          run: () => ({ action: "allow" }),
        }),
      ],
      safety: { tune: { "google-speech-output": { mode: "report" } } },
    });

    expect(generateContent.mock.calls[0]?.[0]).toMatchObject({
      contents: [{ role: "user", parts: [{ text: "guarded speech" }] }],
    });
    expect(generateContent.mock.calls[0]?.[0]).not.toHaveProperty("guardrails");
    expect(generateContent.mock.calls[0]?.[0]).not.toHaveProperty("safety");
    expect(result.raw).toBe(raw);
    expect(
      result.safety?.guardrails?.applied.map((entry) => entry.guard),
    ).toEqual(["google-speech-input", "google-speech-output"]);
  });

  it("performs one native audio generation with a structured multi-speaker voice", async () => {
    expect(speechConformanceRow("google").support).toBe("native");
    const raw = {
      candidates: [
        {
          content: {
            parts: [{ inlineData: { data: "AQID", mimeType: "audio/L16" } }],
          },
        },
      ],
    };
    const generateContent = vi.fn(async () => raw);
    const google = createGoogle(client(generateContent), {
      cachedContent: false,
    });
    const voice = {
      speakerVoiceConfigs: [
        {
          speaker: "Alex",
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
        },
        {
          speaker: "Sam",
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } },
        },
      ],
    } as const;

    const result = await google.generateSpeech({
      model: "gemini-2.5-flash-preview-tts",
      text: "Alex: Hello. Sam: Hi!",
      voice,
      language: "en",
    });

    expect(generateContent).toHaveBeenCalledOnce();
    expect(generateContent).toHaveBeenCalledWith({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ role: "user", parts: [{ text: "Alex: Hello. Sam: Hi!" }] }],
      config: {
        abortSignal: expect.any(AbortSignal),
        responseModalities: ["AUDIO"],
        speechConfig: { languageCode: "en", multiSpeakerVoiceConfig: voice },
      },
    });
    expect(result.raw).toBe(raw);
    expect(result.audio).toMatchObject({
      type: "data",
      mediaType: "audio/L16",
    });
    expect([...(result.audio.data as Uint8Array)]).toEqual([1, 2, 3]);
    expect(result.execution).toEqual({ kind: "native", calls: 1 });
    expectTypeOf(google.generateSpeech).toBeFunction();
  });

  it("rejects prompt-emulated controls before provider I/O", async () => {
    const generateContent = vi.fn();
    const google = createGoogle(client(generateContent), {
      cachedContent: false,
    });
    await expect(
      google.generateSpeech({
        model: "gemini-2.5-flash-preview-tts",
        text: "Hello",
        speed: 2,
      }),
    ).rejects.toMatchObject({ code: "unsupported_capability" });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("lets unknown Gemini ids reach the SDK and rejects missing audio MIME", async () => {
    const withoutMime = {
      candidates: [{ content: { parts: [{ inlineData: { data: "AQID" } }] } }],
    };
    const generateContent = vi.fn(async () => withoutMime);
    const google = createGoogle(client(generateContent), {
      cachedContent: false,
    });

    await expect(
      google.generateSpeech({
        model: "gemini-future-voice-model",
        text: "Hello",
      }),
    ).rejects.toThrow(/MIME/i);
    expect(generateContent).toHaveBeenCalledOnce();
  });
});

function client(generateContent: ReturnType<typeof vi.fn>): GoogleGenAI {
  return { models: { generateContent } } as unknown as GoogleGenAI;
}
