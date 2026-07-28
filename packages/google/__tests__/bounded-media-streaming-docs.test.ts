import { describe, expect, it } from "vitest";
import { GoogleGenAI } from "@google/genai";
import { inMemoryAssetStore } from "@use-crux/core/storage";
import { createGoogle } from "../src";

/**
 * Compile the complete Google speech-stream example used by the multimodal
 * guide. It is intentionally not invoked by tests because it performs SDK I/O.
 */
async function googleSpeechStreamExample(apiKey: string) {
  const google = createGoogle(new GoogleGenAI({ apiKey }));
  const audioChunks: Uint8Array[] = [];
  const assets = inMemoryAssetStore();
  const controller = new AbortController();
  let audioMediaType: string | undefined;

  const result = await google.streamSpeech({
    model: "gemini-3.1-flash-tts-preview",
    text: "Welcome aboard",
    voice: "Kore",
    abortSignal: controller.signal,
  });

  for await (const event of result.fullStream) {
    switch (event.type) {
      case "start":
      case "finish":
        break;
      case "audio-delta":
        audioChunks.push(event.data);
        audioMediaType ??= event.mediaType;
        break;
      case "audio":
        audioMediaType = event.audio.mediaType;
        break;
    }
  }

  const narration = await result.completion;
  const storedNarration = await assets.put(narration.audio);
  return { narration, storedNarration, audioChunks, audioMediaType };
}

describe("Google bounded-media documentation example", () => {
  it("stays a checked public-API program without making provider calls", () => {
    expect(typeof googleSpeechStreamExample).toBe("function");
  });
});
