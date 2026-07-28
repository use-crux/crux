import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import { boundedMediaStreamingConformance } from "@use-crux/core/adapter/testing";
import { createOpenAI } from "../src";
import { clientWith, completed, firstPreview } from "./image-streaming.fixture";

describe("OpenAI bounded media streaming conformance", () => {
  it("obeys the shared native image and speech stream laws", async () => {
    const image = clientWith([firstPreview, completed]);
    const rawSpeech = responseWithChunks([new Uint8Array([7, 8])]);
    const createSpeech = vi.fn(async () => rawSpeech);
    const openai = createOpenAI({
      ...image.client,
      audio: { speech: { create: createSpeech } },
    } as unknown as OpenAI);

    const violations = await boundedMediaStreamingConformance([
      {
        operation: "image",
        progressiveEvent: "image-preview",
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
            result: await openai.streamImage({
              model: "gpt-image-2",
              prompt: "A quiet canal",
              extra: { partial_images: 1 },
            }),
            raw: completed,
            nativeCalls: image.generate.mock.calls.length,
          };
        },
      },
      {
        operation: "speech",
        progressiveEvent: "audio-delta",
        completionKeys: ["audio", "warnings", "execution", "raw", "_meta"],
        async run() {
          return {
            result: await openai.streamSpeech({
              model: "gpt-4o-mini-tts",
              text: "Welcome aboard",
              voice: "alloy",
            }),
            raw: rawSpeech,
            nativeCalls: createSpeech.mock.calls.length,
          };
        },
      },
    ]);

    expect(violations).toEqual([]);
  });
});

function responseWithChunks(chunks: readonly Uint8Array[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(chunk));
        controller.close();
      },
    }),
  );
}
