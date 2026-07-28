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

/**
 * Compile the Google multi-speaker and image-stream shapes documented by the
 * Media guides. The fixture is never invoked because both methods perform SDK
 * I/O.
 */
async function googleMediaExample(apiKey: string) {
  const google = createGoogle(new GoogleGenAI({ apiKey }));

  const dialogue = await google.generateSpeech({
    model: "gemini-2.5-flash-preview-tts",
    text: "Alex: Welcome. Sam: Thanks, it is good to be here.",
    language: "en",
    voice: {
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
    },
  });

  const imageStream = await google.streamImage({
    model: "gemini-3.1-flash-image",
    prompt: "A quiet canal at sunrise",
  });
  const chunks = new Map<number, Uint8Array[]>();
  for await (const event of imageStream.fullStream) {
    if (event.type === "image-delta") {
      const output = chunks.get(event.outputIndex) ?? [];
      output.push(event.data);
      chunks.set(event.outputIndex, output);
    }
  }

  return { dialogue, image: await imageStream.completion, chunks };
}

describe("Google bounded-media documentation example", () => {
  it("stays a checked public-API program without making provider calls", () => {
    expect(typeof googleSpeechStreamExample).toBe("function");
    expect(typeof googleMediaExample).toBe("function");
  });
});
