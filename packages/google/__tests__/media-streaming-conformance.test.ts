import { describe, expect, it } from "vitest";
import type { GoogleGenAI } from "@google/genai";
import { boundedMediaStreamingConformance } from "@use-crux/core/adapter/testing";
import { createGoogle } from "../src";
import {
  clientWith as imageClientWith,
  interactionCompleted,
  sparseInterleavedEvents,
} from "./image-streaming.fixture";
import {
  clientWith as speechClientWith,
  firstAudioChunk,
  terminalResponse,
} from "./speech-streaming.fixture";

describe("Google bounded media streaming conformance", () => {
  it("obeys the shared native image and speech stream laws", async () => {
    const image = imageClientWith(sparseInterleavedEvents);
    const speech = speechClientWith([firstAudioChunk, terminalResponse]);
    const google = createGoogle(
      {
        ...image.client,
        models: speech.client.models,
      } as unknown as GoogleGenAI,
      { cachedContent: false },
    );

    const violations = await boundedMediaStreamingConformance([
      {
        operation: "image",
        progressiveEvent: "image-delta",
        completionKeys: [
          "image",
          "images",
          "warnings",
          "execution",
          "raw",
          "providerMetadata",
          "_meta",
        ],
        async run() {
          return {
            result: await google.streamImage({
              model: "gemini-3.1-flash-image",
              prompt: "A quiet canal",
            }),
            raw: interactionCompleted,
            nativeCalls: image.create.mock.calls.length,
          };
        },
      },
      {
        operation: "speech",
        progressiveEvent: "audio-delta",
        completionKeys: ["audio", "warnings", "execution", "raw", "_meta"],
        async run() {
          return {
            result: await google.streamSpeech({
              model: "gemini-3.1-flash-tts-preview",
              text: "Welcome aboard",
              voice: "Kore",
            }),
            raw: terminalResponse,
            nativeCalls: speech.generateContentStream.mock.calls.length,
          };
        },
      },
    ]);

    expect(violations).toEqual([]);
  });
});
