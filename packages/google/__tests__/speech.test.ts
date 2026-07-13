import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { GoogleGenAI } from "@google/genai";
import { speechConformanceRow } from "@use-crux/core/adapter/testing";
import { createGoogle } from "../src";

describe("Google speech", () => {
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
